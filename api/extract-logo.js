const { extractLogosFromUrl } = require('./_lib/extract-core');

/**
 * Main API handler.
 * POST /api/extract-logo
 * Body: { url: string }
 * Returns: { success, logos: [{ base64, width, height, source, originalUrl }], domain }
 */
module.exports = async (req, res) => {
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

  try {
    const { domain, logos } = await extractLogosFromUrl(rawUrl, { includeBase64: true });

    return res.status(200).json({
      success: true,
      logos: logos.map(({ buffer, ...rest }) => rest),
      domain,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) {
      console.error('Unexpected error:', err);
    }
    return res.status(status).json({
      success: false,
      error: err.message || 'An unexpected error occurred',
      ...(err.domain ? { domain: err.domain } : {}),
    });
  }
};
