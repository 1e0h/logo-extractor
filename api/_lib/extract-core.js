const axios = require('axios');
const { detectLogos } = require('./logo-detector');
const { convertToTransparentPng, upscaleSmallSquareLogo } = require('./image-converter');
const { detectStudioDesignLogos } = require('./studio-design');

const MAX_LOGOS = 6;
const FETCH_TIMEOUT = 10000;
const IMAGE_FETCH_TIMEOUT = 8000;
const MAX_BANNER_BYTES = 400 * 1024;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SOCIAL_SOURCES = new Set(['og:image', 'twitter:image']);
const ICON_SOURCES = new Set([
  'apple-touch-icon',
  'favicon',
  'manifest-icon',
  'ms-tile',
  'default-favicon',
  'google-favicon-api',
  'img-logo',
  'img-logo-parent',
  'img-logo-srcset',
  'inline-svg',
  'studio-header-logo',
  'studio-page-image',
]);

function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (!url) throw Object.assign(new Error('URL is required'), { statusCode: 400 });
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  try {
    // Validate
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

function isProbablyImageBuffer(buffer, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/plain')) {
    return false;
  }
  if (!buffer || buffer.length < 24) return false;

  // PNG / JPEG / GIF / WEBP / ICO magic
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true;
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return true;
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
    return true;
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return true;
  }

  const head = buffer.slice(0, 200).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml') || head.includes('<svg')) return true;
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return false;

  // Unknown but content-type says image
  return ct.startsWith('image/');
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

  const buffer = Buffer.from(response.data);
  const contentType = response.headers['content-type'] || '';
  if (!isProbablyImageBuffer(buffer, contentType)) {
    throw new Error(`Not an image (${contentType || 'unknown type'})`);
  }

  return { buffer, contentType };
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
 * Re-rank using actual image geometry so SPA favicons beat OGP banners,
 * without demoting legitimate wide wordmark logos from HTML.
 */
function refineLogoScore(logo) {
  let score = logo.score || 0;
  const w = logo.width || 0;
  const h = logo.height || 0;
  if (!w || !h) return score;

  const aspect = w / h;
  const isSquare = aspect >= 0.75 && aspect <= 1.35;
  // Classic social-card ratio (~1.91) — not typical wordmarks
  const isSocialBanner = aspect >= 1.85 || aspect <= 0.55;
  const isHtmlLogo = /img-logo|inline-svg/.test(logo.source || '');

  if (isHtmlLogo) score += 20;
  if (logo.source === 'studio-header-logo') score += 30;
  if (logo.source === 'studio-page-image') score += 10;
  if (isSquare) score += 15;
  if (ICON_SOURCES.has(logo.source) && isSquare) score += 10;

  if (isSocialBanner && SOCIAL_SOURCES.has(logo.source)) score -= 45;
  else if (isSocialBanner && !isHtmlLogo) score -= 30;

  // Tiny square icons are still usable after upscale (SPA favicon logos)
  if (isSquare && Math.max(w, h) <= 128) score += 5;

  if (isSocialBanner && (logo.fileSize || 0) > MAX_BANNER_BYTES) score -= 15;

  return score;
}

function prioritizeCandidates(candidates) {
  const icons = [];
  const social = [];
  const other = [];

  for (const c of candidates) {
    if (SOCIAL_SOURCES.has(c.source)) social.push(c);
    else if (ICON_SOURCES.has(c.source) || /logo/i.test(c.source)) icons.push(c);
    else other.push(c);
  }

  // Icons first, then other, social last (OGP banners)
  return icons.concat(other, social);
}

async function processCandidate(candidate, { skipHeavyBanners }) {
  const { buffer: imgBuffer, contentType } = await fetchImage(candidate.url);
  if (imgBuffer.length < 100) return null;

  // Skip huge likely-banner payloads when we already have icon candidates queued
  if (
    skipHeavyBanners &&
    SOCIAL_SOURCES.has(candidate.source) &&
    imgBuffer.length > MAX_BANNER_BYTES
  ) {
    return null;
  }

  let { buffer: pngBuffer, width, height } = await convertToTransparentPng(
    imgBuffer,
    contentType
  );

  const upscaled = await upscaleSmallSquareLogo(pngBuffer, width, height, 512);
  pngBuffer = upscaled.buffer;
  width = upscaled.width;
  height = upscaled.height;

  return {
    buffer: pngBuffer,
    width,
    height,
    source: candidate.source,
    score: candidate.score,
    originalUrl: candidate.url.startsWith('data:') ? '(inline)' : candidate.url,
    fileSize: pngBuffer.length,
  };
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

  // Studio.Design SPAs: logo lives in client-rendered header (page-views JSON)
  try {
    const studioLogos = await detectStudioDesignLogos(html);
    if (studioLogos.length > 0) {
      candidates = candidates.concat(studioLogos);
      candidates.sort((a, b) => b.score - a.score);
    }
  } catch (err) {
    console.error('Studio.Design logo detection failed:', err.message);
  }

  const manifestCandidate = candidates.find((c) => c.source === 'manifest');
  if (manifestCandidate) {
    const manifestIcons = await fetchManifestIcons(manifestCandidate.url);
    candidates = candidates.filter((c) => c.source !== 'manifest').concat(manifestIcons);
    candidates.sort((a, b) => b.score - a.score);
  }

  candidates = prioritizeCandidates(candidates);
  const topCandidates = candidates.slice(0, Math.max(maxLogos, 8));
  const hasIconCandidate = topCandidates.some(
    (c) => ICON_SOURCES.has(c.source) || /logo/i.test(c.source)
  );

  const imageResults = await Promise.all(
    topCandidates.map(async (candidate) => {
      try {
        return await processCandidate(candidate, { skipHeavyBanners: hasIconCandidate });
      } catch (err) {
        console.error(`Failed to process ${candidate.source}: ${err.message}`);
        return null;
      }
    })
  );

  let logos = imageResults.filter(Boolean).map((logo) => ({
    ...logo,
    score: refineLogoScore(logo),
  }));

  logos = logos.filter((logo) => logo.score >= 20);
  logos.sort((a, b) => b.score - a.score);
  logos = logos.slice(0, maxLogos);

  if (logos.length === 0) {
    throw Object.assign(new Error('No logos could be extracted from this website.'), {
      statusCode: 404,
      domain,
    });
  }

  if (includeBase64) {
    for (const logo of logos) {
      logo.base64 = `data:image/png;base64,${logo.buffer.toString('base64')}`;
    }
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
