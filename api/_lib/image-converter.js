const sharp = require('sharp');

/**
 * Detect if a buffer is likely SVG content.
 */
function isSvgBuffer(buffer) {
  const head = buffer.slice(0, 500).toString('utf8').trim();
  return head.startsWith('<svg') || head.startsWith('<?xml') || head.includes('<svg');
}

/**
 * Detect if a buffer is an ICO file.
 */
function isIcoBuffer(buffer) {
  // ICO files start with 00 00 01 00
  return buffer.length >= 4 &&
    buffer[0] === 0 && buffer[1] === 0 &&
    buffer[2] === 1 && buffer[3] === 0;
}

/**
 * Detect the dominant background color by sampling corner and edge pixels.
 * Returns { r, g, b } or null if no consistent background is found.
 */
function detectBackgroundColor(rawData, width, height, channels) {
  if (channels < 3) return null;

  const getPixel = (x, y) => {
    const idx = (y * width + x) * channels;
    return { r: rawData[idx], g: rawData[idx + 1], b: rawData[idx + 2] };
  };

  // Sample corners and some edge pixels
  const samplePoints = [
    [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],  // corners
    [Math.floor(width / 2), 0], [Math.floor(width / 2), height - 1],    // top/bottom middle
    [0, Math.floor(height / 2)], [width - 1, Math.floor(height / 2)],   // left/right middle
    [1, 1], [width - 2, 1], [1, height - 2], [width - 2, height - 2],   // near-corners
  ];

  const samples = samplePoints
    .filter(([x, y]) => x >= 0 && x < width && y >= 0 && y < height)
    .map(([x, y]) => getPixel(x, y));

  if (samples.length === 0) return null;

  // Group similar colors
  const groups = [];
  const tolerance = 25;

  for (const sample of samples) {
    let added = false;
    for (const group of groups) {
      if (
        Math.abs(group.r - sample.r) <= tolerance &&
        Math.abs(group.g - sample.g) <= tolerance &&
        Math.abs(group.b - sample.b) <= tolerance
      ) {
        group.count++;
        group.r = Math.round((group.r * (group.count - 1) + sample.r) / group.count);
        group.g = Math.round((group.g * (group.count - 1) + sample.g) / group.count);
        group.b = Math.round((group.b * (group.count - 1) + sample.b) / group.count);
        added = true;
        break;
      }
    }
    if (!added) {
      groups.push({ ...sample, count: 1 });
    }
  }

  // The background color is the most common group, but only if it appears in >= 50% of samples
  groups.sort((a, b) => b.count - a.count);
  const dominant = groups[0];

  if (dominant && dominant.count >= samples.length * 0.5) {
    return { r: dominant.r, g: dominant.g, b: dominant.b };
  }

  return null;
}

/**
 * Remove background color from raw RGBA pixel data using flood-fill from edges.
 * This is more accurate than simply replacing all matching pixels.
 */
function removeBackground(rawData, width, height, bgColor, tolerance = 30) {
  const channels = 4; // RGBA
  const visited = new Uint8Array(width * height);
  const toProcess = [];

  const colorDistance = (idx) => {
    const r = rawData[idx];
    const g = rawData[idx + 1];
    const b = rawData[idx + 2];
    return Math.sqrt(
      (r - bgColor.r) ** 2 +
      (g - bgColor.g) ** 2 +
      (b - bgColor.b) ** 2
    );
  };

  const isBackground = (idx) => colorDistance(idx) <= tolerance;

  // Seed flood-fill from all edge pixels that match the background
  for (let x = 0; x < width; x++) {
    const topIdx = x * channels;
    const bottomIdx = ((height - 1) * width + x) * channels;
    if (isBackground(topIdx)) toProcess.push([x, 0]);
    if (isBackground(bottomIdx)) toProcess.push([x, height - 1]);
  }
  for (let y = 1; y < height - 1; y++) {
    const leftIdx = (y * width) * channels;
    const rightIdx = (y * width + width - 1) * channels;
    if (isBackground(leftIdx)) toProcess.push([0, y]);
    if (isBackground(rightIdx)) toProcess.push([width - 1, y]);
  }

  // BFS flood-fill
  while (toProcess.length > 0) {
    const [x, y] = toProcess.pop();
    const pixelIndex = y * width + x;

    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (visited[pixelIndex]) continue;
    visited[pixelIndex] = 1;

    const dataIdx = pixelIndex * channels;
    if (!isBackground(dataIdx)) continue;

    // Calculate alpha based on distance from background color
    const dist = colorDistance(dataIdx);
    if (dist <= tolerance * 0.6) {
      // Clearly background: fully transparent
      rawData[dataIdx + 3] = 0;
    } else {
      // Edge pixel: partial transparency for smooth edges
      const alpha = Math.round(((dist - tolerance * 0.6) / (tolerance * 0.4)) * 255);
      rawData[dataIdx + 3] = Math.min(alpha, rawData[dataIdx + 3]);
    }

    // Expand to neighbors (4-connected)
    toProcess.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

/**
 * Convert any image buffer to a transparent PNG.
 * Handles: SVG, JPG/JPEG, PNG, WebP, ICO, GIF
 */
async function convertToTransparentPng(buffer, contentType = '') {
  const ct = contentType.toLowerCase();

  // ── Handle SVG ──────────────────────────────────
  if (ct.includes('svg') || isSvgBuffer(buffer)) {
    try {
      const result = await sharp(buffer, { density: 300 })
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: false })
        .png()
        .toBuffer({ resolveWithObject: true });
      return { buffer: result.data, width: result.info.width, height: result.info.height };
    } catch (err) {
      throw new Error(`SVG conversion failed: ${err.message}`);
    }
  }

  // ── Handle ICO ──────────────────────────────────
  if (ct.includes('x-icon') || ct.includes('vnd.microsoft.icon') || isIcoBuffer(buffer)) {
    try {
      // sharp can handle ICO in most cases (extracts the largest image)
      const result = await sharp(buffer)
        .png()
        .toBuffer({ resolveWithObject: true });
      return { buffer: result.data, width: result.info.width, height: result.info.height };
    } catch {
      // ICO parsing failed, skip
      throw new Error('ICO conversion failed');
    }
  }

  // ── Handle standard image formats ───────────────
  let image = sharp(buffer);
  const metadata = await image.metadata();

  // If the image already has an alpha channel and is not JPEG, assume transparency is intentional
  if (metadata.hasAlpha && !ct.includes('jpeg') && !ct.includes('jpg')) {
    const result = await image
      .png()
      .toBuffer({ resolveWithObject: true });
    return { buffer: result.data, width: result.info.width, height: result.info.height };
  }

  // ── Background removal for JPEG or non-alpha images ──
  const { data: rawData, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bgColor = detectBackgroundColor(rawData, info.width, info.height, 4);

  if (bgColor) {
    removeBackground(rawData, info.width, info.height, bgColor, 35);
  }

  const result = await sharp(rawData, {
    raw: { width: info.width, height: info.height, channels: 4 }
  })
    .png()
    .toBuffer({ resolveWithObject: true });

  return { buffer: result.data, width: result.info.width, height: result.info.height };
}

module.exports = { convertToTransparentPng, isSvgBuffer };
