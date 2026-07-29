const axios = require('axios');
const { detectLogos } = require('./_lib/logo-detector');
const { convertToTransparentPng, isSvgBuffer } = require('./_lib/image-converter');

const MAX_LOGOS = 6;
const FETCH_TIMEOUT = 8000;
const IMAGE_FETCH_TIMEOUT = 6000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Normalize a user-provided URL.
 */
function normalizeUrl(input) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  return url;
}

/**
 * Fetch a remote URL with proper error handling and timeout.
 */
async function fetchUrl(url, options = {}) {
  const { timeout = FETCH_TIMEOUT, responseType = 'text', maxRedirects = 5 } = options;
  return axios.get(url, {
    timeout,
    responseType,
    maxRedirects,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': responseType === 'arraybuffer'
        ? 'image/*, */*'
        : 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    },
    // Don't throw on non-2xx for images (some return soft errors)
    validateStatus: (status) => status >= 200 && status < 400,
  });
}

/**
 * Fetch an image from a URL or data URI and return { buffer, contentType }.
 */
async function fetchImage(url) {
  // Handle data URLs
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return {
        buffer: Buffer.from(match[2], 'base64'),
        contentType: match[1],
      };
    }
    // Non-base64 data URL (e.g., SVG with raw text)
    const textMatch = url.match(/^data:([^,]+),(.+)$/);
    if (textMatch) {
      return {
        buffer: Buffer.from(decodeURIComponent(textMatch[2])),
        contentType: textMatch[1].replace(/;.*/, ''),
      };
    }
    throw new Error('Invalid data URL');
  }

  const response = await fetchUrl(url, {
    timeout: IMAGE_FETCH_TIMEOUT,
    responseType: 'arraybuffer',
  });

  return {
    buffer: Buffer.from(response.data),
    contentType: response.headers['content-type'] || '',
  };
}

/**
 * Try to fetch and parse the web manifest for icon URLs.
 */
async function fetchManifestIcons(manifestUrl, baseUrl) {
  try {
    const response = await fetchUrl(manifestUrl, { timeout: 5000 });
    const manifest = JSON.parse(response.data);
    if (manifest.icons && Array.isArray(manifest.icons)) {
      return manifest.icons
        .filter(icon => icon.src)
        .map(icon => {
          const sizes = icon.sizes || '';
          const sizeMatch = sizes.match(/(\d+)x(\d+)/);
          const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
          return {
            url: new URL(icon.src, manifestUrl).href,
            score: 65 + Math.min(size / 20, 5),
            source: 'manifest-icon',
            meta: { sizes, type: icon.type || '' },
          };
        });
    }
  } catch {
    // Manifest fetch/parse failed, ignore
  }
  return [];
}

/**
 * Main API handler.
 * POST /api/extract-logo
 * Body: { url: string }
 * Returns: { success, logos: [{ base64, width, height, source, originalUrl }], domain }
 */
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { url: rawUrl } = req.body || {};
  if (!rawUrl) {
    return res.status(400).json({ success: false, error: 'URL is required' });
  }

  const url = normalizeUrl(rawUrl);
  let domain;
  try {
    domain = new URL(url).hostname;
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid URL' });
  }

  try {
    // ── Step 1: Fetch the HTML page ──
    let html;
    try {
      const response = await fetchUrl(url);
      html = response.data;
    } catch (err) {
      return res.status(422).json({
        success: false,
        error: `Failed to fetch the website: ${err.message}`,
      });
    }

    // ── Step 2: Detect logo candidates ──
    let candidates = detectLogos(html, url);

    // ── Step 3: Check web manifest for icons ──
    const manifestCandidate = candidates.find(c => c.source === 'manifest');
    if (manifestCandidate) {
      const manifestIcons = await fetchManifestIcons(manifestCandidate.url, url);
      candidates = candidates.filter(c => c.source !== 'manifest').concat(manifestIcons);
      candidates.sort((a, b) => b.score - a.score);
    }

    // ── Step 4: Fetch and convert top candidates ──
    const topCandidates = candidates.slice(0, MAX_LOGOS);
    const results = [];

    const imagePromises = topCandidates.map(async (candidate) => {
      try {
        const { buffer: imgBuffer, contentType } = await fetchImage(candidate.url);

        // Skip very small images (likely tracking pixels)
        if (imgBuffer.length < 100) return null;

        // Convert to transparent PNG
        const { buffer: pngBuffer, width, height } = await convertToTransparentPng(imgBuffer, contentType);

        // Skip tiny results (likely favicons that didn't scale well)
        // but keep them if they're the only option
        const base64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;

        return {
          base64,
          width,
          height,
          source: candidate.source,
          score: candidate.score,
          originalUrl: candidate.url.startsWith('data:') ? '(inline)' : candidate.url,
          fileSize: pngBuffer.length,
        };
      } catch (err) {
        // Individual image fetch/conversion failure is non-fatal
        console.error(`Failed to process ${candidate.source}: ${err.message}`);
        return null;
      }
    });

    const imageResults = await Promise.all(imagePromises);
    for (const result of imageResults) {
      if (result) results.push(result);
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No logos could be extracted from this website.',
        domain,
      });
    }

    return res.status(200).json({
      success: true,
      logos: results,
      domain,
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({
      success: false,
      error: `An unexpected error occurred: ${err.message}`,
    });
  }
};
