const axios = require('axios');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse Nuxt __NUXT_DATA__ JSON from HTML, if present.
 */
function parseNuxtData(html) {
  const match = String(html || '').match(
    /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    console.error('Failed to parse __NUXT_DATA__:', err.message);
    return null;
  }
}

function collectStrings(node, out = []) {
  if (typeof node === 'string') {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectStrings(value, out);
  }
  return out;
}

function findSnapshotPath(html, nuxtData) {
  const strings = nuxtData ? collectStrings(nuxtData) : [];
  const fromData = strings.find((s) =>
    /storage\.googleapis\.com\/studio-publish\/projects\//i.test(s)
  );
  if (fromData) return fromData.endsWith('/') ? fromData : `${fromData}/`;

  const decoded = String(html || '').replace(/\\u002F/g, '/');
  const match = decoded.match(
    /https:\/\/storage\.googleapis\.com\/studio-publish\/projects\/[^"'\\\s]+\/[^"'\\\s]+\/?/
  );
  if (!match) return null;
  return match[0].endsWith('/') ? match[0] : `${match[0]}/`;
}

function findPageUuids(nuxtData) {
  if (!nuxtData) return [];
  const strings = collectStrings(nuxtData);
  return [...new Set(strings.filter((s) => UUID_RE.test(s)))];
}

function isStudioDesignHtml(html) {
  const text = String(html || '');
  return (
    /studio\.design|Studio\.Design|studiodesignapp|studio-publish|__NUXT_DATA__/i.test(
      text
    ) || /generator"\s+content="Studio\.Design"/i.test(text)
  );
}

/**
 * Recursively walk a Studio page-view JSON tree and collect logo-like images.
 */
function collectStudioImages(node, ctx = { inHeader: false, inH1: false }, out = []) {
  if (!node || typeof node !== 'object') return out;

  if (Array.isArray(node)) {
    for (const item of node) collectStudioImages(item, ctx, out);
    return out;
  }

  const tagName = String(node.tagName || '').toLowerCase();
  const name = String(node.name || '');
  const nextCtx = {
    inHeader: ctx.inHeader || tagName === 'header' || /^header$/i.test(name),
    inH1: ctx.inH1 || tagName === 'h1',
  };

  const content = node.content;
  if (content && typeof content === 'object') {
    const src = content.src;
    const type = String(content.type || '').toLowerCase();
    const alt = String(content.alt || '');
    if (typeof src === 'string' && /^https?:\/\//i.test(src) && !src.includes('{{')) {
      const isImg = type === 'img' || type === 'image' || /\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(src);
      if (isImg) {
        out.push({
          url: src,
          alt,
          name,
          inHeader: nextCtx.inHeader,
          inH1: nextCtx.inH1,
          type,
        });
      }
    }
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      collectStudioImages(value, nextCtx, out);
    }
  }

  return out;
}

function scoreStudioImage(img) {
  let score = 70;
  const blob = `${img.name} ${img.alt} ${img.url}`.toLowerCase();

  if (img.inHeader) score += 20;
  if (img.inH1) score += 15;
  if (/logo/i.test(blob)) score += 25;
  if (/favicon|icon|og|cover|banner|bg|background|menu|vip/i.test(blob)) score -= 20;

  // Prefer reasonably sized asset filenames like s-550x550_
  const sizeMatch = img.url.match(/s-(\d+)x(\d+)_/i);
  if (sizeMatch) {
    const w = parseInt(sizeMatch[1], 10);
    const h = parseInt(sizeMatch[2], 10);
    const max = Math.max(w, h);
    if (max >= 256 && max <= 1200) score += 10;
    if (max >= 1500) score -= 15; // large photos
    const aspect = w / Math.max(h, 1);
    if (aspect >= 0.75 && aspect <= 1.35) score += 8;
  }

  return score;
}

async function fetchJson(url) {
  const response = await axios.get(url, {
    timeout: 12000,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json,*/*',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });
  return response.data;
}

/**
 * Extract high-quality logo candidates from Studio.Design published sites
 * by reading __NUXT_DATA__ + studio-publish page-views JSON
 * (covers header > h1 > img that only exists after client render).
 *
 * @returns {Promise<Array<{ url: string, score: number, source: string, meta: object }>>}
 */
async function detectStudioDesignLogos(html) {
  if (!isStudioDesignHtml(html)) return [];

  const nuxtData = parseNuxtData(html);
  const snapshotPath = findSnapshotPath(html, nuxtData);
  if (!snapshotPath) return [];

  const uuids = findPageUuids(nuxtData);
  if (uuids.length === 0) return [];

  // Fetch a limited number of page-views in parallel
  const limited = uuids.slice(0, 12);
  const views = await Promise.all(
    limited.map(async (id) => {
      try {
        const data = await fetchJson(`${snapshotPath}page-views/${id}.json`);
        return data;
      } catch (err) {
        // Missing page-view is common for symbol/modal uuids
        return null;
      }
    })
  );

  const images = [];
  for (const view of views) {
    if (!view) continue;
    collectStudioImages(view, { inHeader: false, inH1: false }, images);
  }

  const seen = new Set();
  const candidates = [];
  for (const img of images) {
    if (seen.has(img.url)) continue;
    seen.add(img.url);

    const score = scoreStudioImage(img);
    const blob = `${img.name} ${img.alt} ${img.url}`;
    const keep =
      score >= 90 ||
      (img.inHeader && img.inH1) ||
      (img.inHeader && /logo/i.test(blob)) ||
      (/logo/i.test(blob) && score >= 80);

    if (!keep) continue;

    candidates.push({
      url: img.url,
      score,
      source: img.inHeader || /logo/i.test(blob) ? 'studio-header-logo' : 'studio-page-image',
      meta: {
        alt: img.alt,
        name: img.name,
        inHeader: img.inHeader,
        inH1: img.inH1,
      },
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 6);
}

module.exports = {
  isStudioDesignHtml,
  detectStudioDesignLogos,
};
