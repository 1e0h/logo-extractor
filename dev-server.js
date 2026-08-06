/**
 * Local development server.
 * Mimics Vercel's routing: serves /public as static files,
 * and maps /api/* to serverless function handlers.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const extractLogoHandler = require('./api/extract-logo');
const downloadLogoHandler = require('./api/download-logo');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function wrapRes(res) {
  res.json = (data) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(data));
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);

  // ── CORS preflight ──
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API: extract ──
  if (parsed.pathname === '/api/extract-logo' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        req.body = JSON.parse(body);
      } catch (err) {
        console.error('JSON parse error:', err.message);
        req.body = {};
      }
      wrapRes(res);
      await extractLogoHandler(req, res);
    });
    return;
  }

  // ── API: download ──
  if (parsed.pathname === '/api/download-logo' && req.method === 'GET') {
    req.query = Object.fromEntries(parsed.searchParams.entries());
    wrapRes(res);
    await downloadLogoHandler(req, res);
    return;
  }

  // ── Static Files ──
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(PUBLIC_DIR, filePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (err) {
    console.error('Static file error:', err.message);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  🚀 Logo Extractor running at http://localhost:${PORT}\n`);
});
