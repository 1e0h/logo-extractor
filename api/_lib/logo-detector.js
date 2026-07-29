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

/**
 * Extract logo candidates from HTML content.
 * Returns an array of { url, score, source, meta } sorted by score descending.
 */
function detectLogos(html, baseUrl) {
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
  // Strategy 1: <img> tags with logo-related attributes (highest priority)
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

    const searchTexts = [alt, className, id, imgSrc.toLowerCase(), ariaLabel];
    const logoPatterns = [/logo/i, /brand/i, /site[-_]?icon/i, /company[-_]?mark/i];

    const isLogo = searchTexts.some(text =>
      logoPatterns.some(pattern => pattern.test(text))
    );

    if (isLogo) {
      // Check if it's in the header area for higher priority
      const isInHeader = $(el).closest('header, [class*="header"], [id*="header"], [class*="nav"], nav').length > 0;
      const score = isInHeader ? 95 : 90;
      addCandidate(resolvedSrc, score, 'img-logo', { alt, isInHeader });

      // If there's a higher-res version in srcset, prefer that
      if (srcset) {
        const highResSrc = extractBestFromSrcset(srcset, baseUrl);
        if (highResSrc) {
          addCandidate(highResSrc, score + 1, 'img-logo-srcset', { alt, isInHeader });
        }
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
  // Strategy 4: Open Graph image
  // ────────────────────────────────────────────────
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) {
    const resolvedOg = resolveUrl(ogImage, baseUrl);
    if (resolvedOg) {
      addCandidate(resolvedOg, 60, 'og:image', {});
    }
  }

  // Twitter card image
  const twitterImage = $('meta[name="twitter:image"]').attr('content');
  if (twitterImage) {
    const resolvedTwitter = resolveUrl(twitterImage, baseUrl);
    if (resolvedTwitter) {
      addCandidate(resolvedTwitter, 55, 'twitter:image', {});
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
      `https://www.google.com/s2/favicons?sz=128&domain=${urlObj.hostname}`,
      10,
      'google-favicon-api',
      {}
    );
  } catch {
    // ignore URL parse errors
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
