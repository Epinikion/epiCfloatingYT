'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function mix(a, b, amount) { return a + (b - a) * amount; }
function roundedBoxDistance(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - (halfWidth - radius);
  const qy = Math.abs(y) - (halfHeight - radius);
  return Math.hypot(Math.max(0, qx), Math.max(0, qy)) + Math.min(0, Math.max(qx, qy)) - radius;
}
function insideTriangle(x, y, a, b, c) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const first = cross(a, b, [x, y]);
  const second = cross(b, c, [x, y]);
  const third = cross(c, a, [x, y]);
  return (first >= 0 && second >= 0 && third >= 0) || (first <= 0 && second <= 0 && third <= 0);
}
function over(pixel, color, alpha) {
  const sourceAlpha = clamp(alpha);
  const destinationAlpha = pixel[3];
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    pixel[channel] = (color[channel] * sourceAlpha + pixel[channel] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha;
  }
  pixel[3] = outputAlpha;
}

function draw(size) {
  const output = Buffer.alloc(size * size * 4);
  const samples = size < 48 ? 3 : 2;
  const halfWidth = size * (size < 48 ? 0.44 : 0.36);
  const halfHeight = size * (size < 48 ? 0.30 : 0.235);
  const radius = size * 0.075;
  const playHeight = halfHeight * 1.12;
  const playWidth = playHeight * 0.88;
  const triangle = [
    [-playWidth * 0.42, -playHeight / 2],
    [-playWidth * 0.42, playHeight / 2],
    [playWidth * 0.58, 0],
  ];

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = px + (sx + 0.5) / samples - size / 2;
          const y = py + (sy + 0.5) / samples - size / 2;
          const pixel = [0, 0, 0, 0];
          const distance = roundedBoxDistance(x, y, halfWidth, halfHeight, radius);
          if (distance > 0) {
            const reach = Math.max(1, size / 2 - halfWidth);
            const glow = Math.exp(-distance / (reach * 0.34)) * clamp(1 - distance / reach) * 0.8;
            const horizontal = clamp(x / (halfWidth * 2) + 0.5);
            const top = clamp(-y / (halfHeight * 2));
            over(pixel, [mix(255, 255, horizontal), mix(72, 45, horizontal), mix(32, 108, horizontal) + top * 70], glow);
          }
          if (distance <= 0.5) {
            const edge = clamp(0.5 - distance);
            const shade = clamp((x + y + halfWidth + halfHeight) / (2 * (halfWidth + halfHeight)));
            over(pixel, [mix(37, 9, shade), mix(37, 9, shade), mix(44, 13, shade)], edge);
            if (insideTriangle(x, y, triangle[0], triangle[1], triangle[2])) {
              const vertical = clamp(y / playHeight + 0.5);
              over(pixel, [255, mix(92, 45, vertical), mix(58, 45, vertical)], edge);
            }
          }
          for (let channel = 0; channel < 4; channel += 1) sum[channel] += pixel[channel];
        }
      }
      const offset = (py * size + px) * 4;
      const divisor = samples * samples;
      output[offset] = Math.round(sum[0] / divisor);
      output[offset + 1] = Math.round(sum[1] / divisor);
      output[offset + 2] = Math.round(sum[2] / divisor);
      output[offset + 3] = Math.round(sum[3] / divisor * 255);
    }
  }
  return output;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}
function png(size, pixels) {
  const rowLength = size * 4;
  const raw = Buffer.alloc((rowLength + 1) * size);
  for (let y = 0; y < size; y += 1) pixels.copy(raw, y * (rowLength + 1) + 1, y * rowLength, (y + 1) * rowLength);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function ico(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    directory[entry] = image.size === 256 ? 0 : image.size;
    directory[entry + 1] = image.size === 256 ? 0 : image.size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });
  return Buffer.concat([directory, ...images.map((image) => image.data)]);
}

const build = path.join(root, 'build');
fs.mkdirSync(build, { recursive: true });
const images = sizes.map((size) => ({ size, data: png(size, draw(size)) }));
fs.writeFileSync(path.join(build, 'icon.ico'), ico(images));
fs.writeFileSync(path.join(build, 'icon.png'), png(512, draw(512)));
console.log('App-Icons erzeugt.');

