const { extractLogosFromUrl, safeFilename } = require('./_lib/extract-core');

/**
 * GET /api/download-logo?url=...&index=0
 * Returns the best (or indexed) logo as a PNG attachment for direct download / LINE share.
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
  }

  const query = req.query || {};
  const rawUrl = query.url;
  const index = Math.max(0, parseInt(query.index, 10) || 0);

  if (!rawUrl) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ success: false, error: 'URL is required' }));
  }

  try {
    // Fetch enough logos to cover the requested index
    const { domain, logos } = await extractLogosFromUrl(rawUrl, {
      maxLogos: Math.max(6, index + 1),
      includeBase64: false,
    });

    const logo = logos[Math.min(index, logos.length - 1)];
    if (!logo || !logo.buffer) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ success: false, error: 'Logo not found', domain }));
    }

    const filename = safeFilename(domain);

    // octet-stream + attachment helps LINE / in-app browsers download instead of preview
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', logo.buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(logo.buffer);
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) {
      console.error('Download error:', err);
    }
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify({
        success: false,
        error: err.message || 'An unexpected error occurred',
        ...(err.domain ? { domain: err.domain } : {}),
      })
    );
  }
};
