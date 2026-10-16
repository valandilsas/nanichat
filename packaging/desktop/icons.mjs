// Generates the desktop app icons into build/: icon.ico (Windows installer, shortcuts, window) and icon.png
// (512x512, Linux AppImage/deb, window and tray). The artwork comes from packaging/windows/lib/icon.mjs (single
// source of truth): its 256x256 ICO image is decoded and upscaled 2x with bilinear filtering for the PNG.
// Node.js built-ins only. Written to disk by `npm run desktop:icons` (packaging/desktop/run.mjs).
import { crc32, deflateSync } from 'node:zlib';
import { createIco } from '../windows/lib/icon.mjs';

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Decodes the 32-bit BGRA DIB of one ICO entry into top-down RGBA pixels. */
export function rgbaFromIcoEntry(ico, index) {
  const entry = 6 + index * 16;
  const size = ico.readUInt8(entry) || 256;
  const offset = ico.readUInt32LE(entry + 12);
  const pixelsStart = offset + ico.readUInt32LE(offset); // after the BITMAPINFOHEADER
  const rgba = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row++) {
    const sourceRow = size - 1 - row; // DIB rows are bottom-up
    for (let x = 0; x < size; x++) {
      const source = pixelsStart + (sourceRow * size + x) * 4;
      const target = (row * size + x) * 4;
      rgba[target] = ico[source + 2];
      rgba[target + 1] = ico[source + 1];
      rgba[target + 2] = ico[source];
      rgba[target + 3] = ico[source + 3];
    }
  }
  return { size, rgba };
}

/** Bilinear upscale of premultiplied RGBA (premultiplying avoids dark fringes at transparent edges). */
export function upscale({ size, rgba }, factor) {
  const target = size * factor;
  const out = Buffer.alloc(target * target * 4);
  const sample = (x, y, channel) => {
    const cx = Math.min(Math.max(x, 0), size - 1);
    const cy = Math.min(Math.max(y, 0), size - 1);
    const offset = (cy * size + cx) * 4;
    const alpha = rgba[offset + 3] / 255;
    return channel === 3 ? rgba[offset + 3] : rgba[offset + channel] * alpha;
  };
  for (let ty = 0; ty < target; ty++) {
    const sy = (ty + 0.5) / factor - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let tx = 0; tx < target; tx++) {
      const sx = (tx + 0.5) / factor - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const value = (channel) => (sample(x0, y0, channel) * (1 - fx) + sample(x0 + 1, y0, channel) * fx) * (1 - fy)
        + (sample(x0, y0 + 1, channel) * (1 - fx) + sample(x0 + 1, y0 + 1, channel) * fx) * fy;
      const offset = (ty * target + tx) * 4;
      const alpha = value(3);
      out[offset + 3] = Math.round(alpha);
      for (let channel = 0; channel < 3; channel++) {
        out[offset + channel] = alpha > 0 ? Math.min(255, Math.round((value(channel) * 255) / alpha)) : 0;
      }
    }
  }
  return { size: target, rgba: out };
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes top-down RGBA pixels as a PNG (8-bit RGBA, no filtering). */
export function encodePng({ size, rgba }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(6, 9); // colour type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row++) {
    raw[row * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function buildIcons() {
  const ico = createIco(ICO_SIZES);
  const png = encodePng(upscale(rgbaFromIcoEntry(ico, ICO_SIZES.indexOf(256)), 2));
  return { ico, png };
}

