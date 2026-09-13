import zlib from 'node:zlib';

const WIDTH = 640;
const HEIGHT = 360;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function setPixel(pixels, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) return;
  const offset = (py * WIDTH + px) * 4;
  const alpha = color[3] / 255;
  pixels[offset] = Math.round(color[0] * alpha + pixels[offset] * (1 - alpha));
  pixels[offset + 1] = Math.round(color[1] * alpha + pixels[offset + 1] * (1 - alpha));
  pixels[offset + 2] = Math.round(color[2] * alpha + pixels[offset + 2] * (1 - alpha));
  pixels[offset + 3] = 255;
}

function drawLine(pixels, from, to, color, width = 1) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let index = 0; index <= steps; index += 1) {
    const x = from[0] + (dx * index) / steps;
    const y = from[1] + (dy * index) / steps;
    for (let ox = -Math.floor(width / 2); ox <= Math.floor(width / 2); ox += 1) {
      for (let oy = -Math.floor(width / 2); oy <= Math.floor(width / 2); oy += 1) {
        setPixel(pixels, x + ox, y + oy, color);
      }
    }
  }
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > point[1] !== yj > point[1]
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function boundsFor(area, segments) {
  const coordinates = [
    ...(area?.geometry?.coordinates?.flat(1) || []),
    ...(segments?.features || []).flatMap((feature) => feature.geometry?.coordinates || [])
  ].filter((coordinate) => Array.isArray(coordinate) && coordinate.length >= 2);
  if (!coordinates.length) return [-97, 32.7, -96.7, 32.9];
  const xs = coordinates.map((coordinate) => coordinate[0]);
  const ys = coordinates.map((coordinate) => coordinate[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function encodePng(pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const rowOffset = y * (WIDTH * 4 + 1);
    rows[rowOffset] = 0;
    pixels.copy(rows, rowOffset + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export function createStudyThumbnail(area, segments) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 238;
    pixels[offset + 1] = 243;
    pixels[offset + 2] = 244;
    pixels[offset + 3] = 255;
  }

  const [minX, minY, maxX, maxY] = boundsFor(area, segments);
  const spanX = Math.max(maxX - minX, 0.0001);
  const spanY = Math.max(maxY - minY, 0.0001);
  const padding = 28;
  const scale = Math.min((WIDTH - padding * 2) / spanX, (HEIGHT - padding * 2) / spanY);
  const project = ([lng, lat]) => [
    (lng - (minX + maxX) / 2) * scale + WIDTH / 2,
    HEIGHT / 2 - (lat - (minY + maxY) / 2) * scale
  ];

  for (const feature of segments?.features || []) {
    const coordinates = feature.geometry?.coordinates || [];
    for (let index = 1; index < coordinates.length; index += 1) {
      drawLine(pixels, project(coordinates[index - 1]), project(coordinates[index]), [171, 184, 188, 255], 2);
    }
  }

  const ring = (area?.geometry?.coordinates?.[0] || []).map(project);
  if (ring.length >= 3) {
    const xs = ring.map((point) => point[0]);
    const ys = ring.map((point) => point[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(HEIGHT - 1, Math.ceil(Math.max(...ys))); y += 1) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(WIDTH - 1, Math.ceil(Math.max(...xs))); x += 1) {
        if (pointInPolygon([x, y], ring)) setPixel(pixels, x, y, [245, 200, 66, 72]);
      }
    }
    for (let index = 1; index < ring.length; index += 1) {
      drawLine(pixels, ring[index - 1], ring[index], [9, 76, 86, 255], 5);
    }
  }

  return encodePng(pixels);
}
