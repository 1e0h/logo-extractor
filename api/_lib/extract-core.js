const axios = require('axios');
const { detectLogos } = require('./logo-detector');
const { convertToTransparentPng } = require('./image-converter');

const MAX_LOGOS = 6;
const FETCH_TIMEOUT = 8000;
const IMAGE_FETCH_TIMEOUT = 6000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (!url) throw Object.assign(new Error('URL is required'), { statusCode: 400 });
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  try {
    // Validate
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { statusCode: 400 });
  }
  return url;
}

async function fetchUrl(url, options = {}) {
  const { timeout = FETCH_TIMEOUT, responseType = 'text', maxRedirects = 5 } = options;
  return axios.get(url, {
    timeout,
    responseType,
    maxRedirects,
    headers: {
      'User-Agent': USER_AGENT,
      Accept:
        responseType === 'arraybuffer'
          ? 'image/*, */*'
          : 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });
}

async function fetchImage(url) {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return {
        buffer: Buffer.from(match[2], 'base64'),
        contentType: match[1],
      };
    }
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

async function fetchManifestIcons(manifestUrl) {
  try {
    const response = await fetchUrl(manifestUrl, { timeout: 5000 });
    const manifest = JSON.parse(response.data);
    if (manifest.icons && Array.isArray(manifest.icons)) {
      return manifest.icons
        .filter((icon) => icon.src)
        .map((icon) => {
          const sizes = icon.sizes || '';
          const sizeMatch = sizes.match(/(\d+)x(\d+)/);
          const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
          return {
            url: new URL(icon.src, manifestUrl).href,
            score: 65 + Math.min(size / 20, 5),
            source: 'manifest-icon',
            meta: { sizes, type: icon.type || '' },
          };
        });
    }
  } catch (err) {
    console.error('Manifest fetch failed:', err.message);
  }
  return [];
}

/**
 * Extract logo PNGs from a website URL.
 * @param {string} rawUrl
 * @param {{ maxLogos?: number, includeBase64?: boolean }} [options]
 * @returns {Promise<{ domain: string, logos: Array }>}
 */
async function extractLogosFromUrl(rawUrl, options = {}) {
  const maxLogos = options.maxLogos ?? MAX_LOGOS;
  const includeBase64 = options.includeBase64 !== false;

  const url = normalizeUrl(rawUrl);
  const domain = new URL(url).hostname;

  let html;
  try {
    const response = await fetchUrl(url);
    html = response.data;
  } catch (err) {
    throw Object.assign(new Error(`Failed to fetch the website: ${err.message}`), {
      statusCode: 422,
    });
  }

  let candidates = detectLogos(html, url);

  const manifestCandidate = candidates.find((c) => c.source === 'manifest');
  if (manifestCandidate) {
    const manifestIcons = await fetchManifestIcons(manifestCandidate.url);
    candidates = candidates.filter((c) => c.source !== 'manifest').concat(manifestIcons);
    candidates.sort((a, b) => b.score - a.score);
  }

  const topCandidates = candidates.slice(0, maxLogos);
  const imageResults = await Promise.all(
    topCandidates.map(async (candidate) => {
      try {
        const { buffer: imgBuffer, contentType } = await fetchImage(candidate.url);
        if (imgBuffer.length < 100) return null;

        const { buffer: pngBuffer, width, height } = await convertToTransparentPng(
          imgBuffer,
          contentType
        );

        const result = {
          buffer: pngBuffer,
          width,
          height,
          source: candidate.source,
          score: candidate.score,
          originalUrl: candidate.url.startsWith('data:') ? '(inline)' : candidate.url,
          fileSize: pngBuffer.length,
        };

        if (includeBase64) {
          result.base64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
        }

        return result;
      } catch (err) {
        console.error(`Failed to process ${candidate.source}: ${err.message}`);
        return null;
      }
    })
  );

  const logos = imageResults.filter(Boolean);
  if (logos.length === 0) {
    throw Object.assign(new Error('No logos could be extracted from this website.'), {
      statusCode: 404,
      domain,
    });
  }

  return { domain, logos };
}

function safeFilename(domain) {
  return `${String(domain || 'logo').replace(/[^a-zA-Z0-9._-]+/g, '_')}_logo.png`;
}

module.exports = {
  normalizeUrl,
  extractLogosFromUrl,
  safeFilename,
  MAX_LOGOS,
};
