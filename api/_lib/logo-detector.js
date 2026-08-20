const cheerio = require('cheerio');

/**
 * Resolve a potentially relative URL against a base URL.
 */
function resolveUrl(href, baseUrl) {
  if (!href) return null;
  try {
    // Handle protocol-relative URLs
    if (href.startsWith('//')) {
      return `https:${href}`;
    }
    // Handle data URLs — return as-is
    if (href.startsWith('data:')) {
      return href;
    }
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

/** Structural / path identifiers — safe to match anywhere including URLs */
const STRUCTURAL_LOGO_RE = /logo|site[-_]?icon|company[-_]?mark|brand[-_]?(?:logo|mark|image|img)?/i;
/** Free-text fields (alt, aria) — avoid "brand new" style false positives */
const TEXT_LOGO_RE = /\blogo\b|\bsite[-_]?icon\b|\bcompany[-_]?mark\b/i;
/** Parent container selectors that usually wrap the real site logo */
const LOGO_PARENT_SELECTOR =
  '[class*="logo" i], [id*="logo" i], [class*="brand" i], [id*="brand" i]';
const HEADER_SELECTOR =
  'header, [class*="header" i], [id*="header" i], [class*="nav" i], nav, [role="banner"]';

function isSameSite(imageUrl, pageUrl) {
  try {
    if (imageUrl.startsWith('data:')) return true;
    const imgHost = new URL(imageUrl).hostname.replace(/^www\./, '');
    const pageHost = new URL(pageUrl).hostname.replace(/^www\./, '');
    return imgHost === pageHost || imgHost.endsWith('.' + pageHost) || pageHost.endsWith('.' + imgHost);
  } catch {
    return false;
  }
}

/**
 * Score an <img> that looks like a logo.
 */
function scoreLogoImage({ isInLogoParent, isInHeader, alt, resolvedSrc, baseUrl }) {
  let score = 70;

  if (isInLogoParent) score += 25;
  if (isInHeader) score += 8;
  if (isSameSite(resolvedSrc, baseUrl)) score += 5;
  else score -= 15;

  // Long alt text is usually a news/article caption, not a logo label
  if (alt.length > 60) score -= 40;
  else if (alt.length > 30) score -= 15;

  return score;
}

/**
 * Extract logo candidates from HTML content.
 * Returns an array of { url, score, source, meta } sorted by score descending.
 * @param {string} html
 * @param {string} baseUrl
 * @param {{ deep?: boolean }} [options]
 */
function detectLogos(html, baseUrl, options = {}) {
  const deep = Boolean(options.deep);
  const $ = cheerio.load(html);
  const candidates = [];
  const seen = new Set();

  function addCandidate(url, score, source, meta = {}) {
    if (!url || seen.has(url)) return;
    // Skip very long data URLs for non-SVG (likely photos)
    if (url.startsWith('data:') && !url.includes('svg') && url.length > 50000) return;
    seen.add(url);
    candidates.push({ url, score, source, meta });
  }

  // ────────────────────────────────────────────────
  // Strategy 1: <img> tags with logo-related attributes / parents
  // ────────────────────────────────────────────────
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    const srcset = $(el).attr('srcset');
    const alt = ($(el).attr('alt') || '').toLowerCase();
    const className = ($(el).attr('class') || '').toLowerCase();
    const id = ($(el).attr('id') || '').toLowerCase();
    const dataSrc = $(el).attr('data-src') || $(el).attr('data-lazy-src');
    const ariaLabel = ($(el).attr('aria-label') || '').toLowerCase();

    const imgSrc = src || dataSrc;
    if (!imgSrc) return;

    const resolvedSrc = resolveUrl(imgSrc, baseUrl);
    if (!resolvedSrc) return;

    const isInLogoParent = $(el).closest(LOGO_PARENT_SELECTOR).length > 0;
    const structuralHit = [className, id, imgSrc.toLowerCase()].some((t) =>
      STRUCTURAL_LOGO_RE.test(t)
    );
    // alt/aria: only clear logo words — not "brand" (matches "brand new" in headlines)
    const textHit = [alt, ariaLabel].some((t) => TEXT_LOGO_RE.test(t));

    if (!isInLogoParent && !structuralHit && !textHit) return;

    const isInHeader = $(el).closest(HEADER_SELECTOR).length > 0;
    const score = scoreLogoImage({
      isInLogoParent,
      isInHeader,
      alt,
      resolvedSrc,
      baseUrl,
    });

    // Skip weak false positives (e.g. news thumbs that only matched loosely)
    if (score < 50) return;

    addCandidate(resolvedSrc, score, isInLogoParent ? 'img-logo-parent' : 'img-logo', {
      alt,
      isInHeader,
      isInLogoParent,
    });

    if (srcset) {
      const highResSrc = extractBestFromSrcset(srcset, baseUrl);
      if (highResSrc) {
        addCandidate(highResSrc, score + 1, 'img-logo-srcset', {
          alt,
          isInHeader,
          isInLogoParent,
        });
      }
    }
  });

  // ────────────────────────────────────────────────
  // Strategy 2: Inline SVG in header/nav areas
  // ────────────────────────────────────────────────
  $('header svg, nav svg, [class*="header"] svg, [class*="logo"] svg, [id*="logo"] svg, a svg').each((_, el) => {
    const svgEl = $(el);
    // Check if parent or ancestor has "logo" in class/id
    const parentClasses = [];
    svgEl.parents().each((__, parent) => {
      parentClasses.push(
        ($(parent).attr('class') || '').toLowerCase(),
        ($(parent).attr('id') || '').toLowerCase()
      );
    });
    const isLogoContext = parentClasses.some(c => /logo|brand|site[-_]?icon/i.test(c));
    const isInHeader = svgEl.closest('header, [class*="header"], nav').length > 0;

    if (isLogoContext || isInHeader) {
      // Serialize the SVG to a data URL
      const svgHtml = $.html(el);
      if (svgHtml && svgHtml.length > 20 && svgHtml.length < 100000) {
        const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgHtml).toString('base64')}`;
        const score = isLogoContext ? 92 : 85;
        addCandidate(svgDataUrl, score, 'inline-svg', { isInHeader, isLogoContext });
      }
    }
  });

  // ────────────────────────────────────────────────
  // Strategy 3: Apple Touch Icon (high quality, square)
  // ────────────────────────────────────────────────
  $('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').each((_, el) => {
    const href = resolveUrl($(el).attr('href'), baseUrl);
    const sizes = $(el).attr('sizes') || '';
    // Higher size → higher score
    const sizeMatch = sizes.match(/(\d+)x(\d+)/);
    const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
    const sizeBonus = Math.min(size / 10, 5); // up to 5 bonus points for large icons
    if (href) {
      addCandidate(href, 75 + sizeBonus, 'apple-touch-icon', { sizes });
    }
  });

  // ────────────────────────────────────────────────
  // Strategy 4: Open Graph / Twitter images
  // (Often social banners — kept as fallback, not preferred over icons)
  // ────────────────────────────────────────────────
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) {
    const resolvedOg = resolveUrl(ogImage, baseUrl);
    if (resolvedOg) {
      addCandidate(resolvedOg, 40, 'og:image', {});
    }
  }

  // Twitter card image (name= or property=)
  const twitterImage =
    $('meta[name="twitter:image"]').attr('content') ||
    $('meta[property="twitter:image"]').attr('content');
  if (twitterImage) {
    const resolvedTwitter = resolveUrl(twitterImage, baseUrl);
    if (resolvedTwitter) {
      addCandidate(resolvedTwitter, 38, 'twitter:image', {});
    }
  }

  // ────────────────────────────────────────────────
  // Strategy 5: Favicon (link tags)
  // ────────────────────────────────────────────────
  $('link[rel="icon"], link[rel="shortcut icon"]').each((_, el) => {
    const href = resolveUrl($(el).attr('href'), baseUrl);
    const sizes = $(el).attr('sizes') || '';
    const type = $(el).attr('type') || '';
    const sizeMatch = sizes.match(/(\d+)x(\d+)/);
    const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
    const sizeBonus = Math.min(size / 20, 5);
    // Prefer SVG favicons
    const svgBonus = type.includes('svg') ? 10 : 0;
    if (href) {
      addCandidate(href, 45 + sizeBonus + svgBonus, 'favicon', { sizes, type });
    }
  });

  // Microsoft tile image
  const msIcon = $('meta[name="msapplication-TileImage"]').attr('content');
  if (msIcon) {
    const resolvedMs = resolveUrl(msIcon, baseUrl);
    if (resolvedMs) {
      addCandidate(resolvedMs, 40, 'ms-tile', {});
    }
  }

  // ────────────────────────────────────────────────
  // Strategy 6: Manifest icon
  // ────────────────────────────────────────────────
  // (We can't fetch the manifest here, but note the link for the caller)
  const manifestLink = $('link[rel="manifest"]').attr('href');
  if (manifestLink) {
    const resolvedManifest = resolveUrl(manifestLink, baseUrl);
    if (resolvedManifest) {
      // Add as meta; the main handler can optionally fetch & parse the manifest
      candidates.push({
        url: resolvedManifest,
        score: 0,
        source: 'manifest',
        meta: { isManifest: true }
      });
    }
  }

  // ────────────────────────────────────────────────
  // Strategy 7: Default paths & Google Favicon API (fallbacks)
  // ────────────────────────────────────────────────
  try {
    const urlObj = new URL(baseUrl);
    addCandidate(`${urlObj.origin}/favicon.ico`, 20, 'default-favicon', {});
    addCandidate(`${urlObj.origin}/logo.png`, 15, 'default-logo-path', {});
    addCandidate(
      `https://www.google.com/s2/favicons?sz=256&domain=${urlObj.hostname}`,
      12,
      'google-favicon-api',
      {}
    );

    if (deep) {
      const deepPaths = [
        '/logo.svg',
        '/logo.webp',
        '/images/logo.png',
        '/images/logo.svg',
        '/img/logo.png',
        '/assets/logo.png',
        '/assets/images/logo.png',
        '/static/logo.png',
        '/wp-content/uploads/logo.png',
      ];
      for (const path of deepPaths) {
        addCandidate(`${urlObj.origin}${path}`, 18, 'deep-default-path', { path });
      }
      addCandidate(
        `https://www.google.com/s2/favicons?sz=128&domain=${urlObj.hostname}`,
        11,
        'google-favicon-api',
        {}
      );
    }
  } catch {
    // ignore URL parse errors
  }

  // ────────────────────────────────────────────────
  // Deep mode: broader header/nav image sweep
  // ────────────────────────────────────────────────
  if (deep) {
    $(`${HEADER_SELECTOR} img, a[href="/"] img, a[href="./"] img, .navbar img, .site-header img`).each(
      (_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        if (!src) return;
        const resolvedSrc = resolveUrl(src, baseUrl);
        if (!resolvedSrc) return;
        const alt = ($(el).attr('alt') || '').toLowerCase();
        if (alt.length > 80) return; // likely article thumb
        const isInHeader = $(el).closest(HEADER_SELECTOR).length > 0;
        addCandidate(resolvedSrc, isInHeader ? 58 : 48, 'deep-header-img', {
          alt,
          isInHeader,
          deep: true,
        });
      }
    );

    // picture > source srcset
    $('picture source, img[srcset]').each((_, el) => {
      const srcset = $(el).attr('srcset');
      if (!srcset) return;
      const best = extractBestFromSrcset(srcset, baseUrl);
      if (!best) return;
      const inHeader = $(el).closest(HEADER_SELECTOR).length > 0;
      if (!inHeader && !/logo|brand|icon/i.test(srcset)) return;
      addCandidate(best, inHeader ? 56 : 42, 'deep-srcset', { deep: true });
    });

    // CSS inline background-image with logo-ish URLs
    $('[style*="background"]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const match = style.match(/url\(['"]?([^'")]+)['"]?\)/i);
      if (!match) return;
      const href = match[1];
      if (!/logo|brand|icon|mark/i.test(href + ' ' + (($(el).attr('class') || '')))) return;
      const resolved = resolveUrl(href, baseUrl);
      if (resolved) addCandidate(resolved, 50, 'deep-css-bg', { deep: true });
    });

    // Boost social images slightly in deep mode (already added above)
    candidates.forEach((c) => {
      if (c.source === 'og:image' || c.source === 'twitter:image') {
        c.score += 8;
      }
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}

/**
 * Extract the highest-resolution URL from an srcset attribute.
 */
function extractBestFromSrcset(srcset, baseUrl) {
  if (!srcset) return null;
  try {
    const parts = srcset.split(',').map(s => s.trim().split(/\s+/));
    let best = null;
    let bestSize = 0;
    for (const [url, descriptor] of parts) {
      const size = descriptor ? parseFloat(descriptor) : 1;
      if (size > bestSize) {
        bestSize = size;
        best = url;
      }
    }
    return best ? resolveUrl(best, baseUrl) : null;
  } catch {
    return null;
  }
}

module.exports = { detectLogos, resolveUrl };
