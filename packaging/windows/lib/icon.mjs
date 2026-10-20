// Generates the NaniChat application icon (.ico) with Node.js built-ins only: the Nani mascot (the same speech
// bubble as app/components/Nani.tsx: pink body, cheeks, dark eyes and smile) on a transparent background. Each size
// is a 32-bit BGRA DIB (the most widely supported ICO image format, accepted by Inno Setup's SetupIconFile and by
// Windows shortcuts), anti-aliased by 4x4 supersampling. Coordinates are the mascot's 120x120 viewBox.

const SAMPLES = 4;
const VIEWBOX = 120;
const BODY = [0xff, 0x6b, 0x8b]; // --pink
const CHEEK = [0xff, 0x9e, 0xb4]; // .nani-cheek
const INK = [0x1a, 0x0d, 0x12]; // --on-color (eyes and mouth)

/** Flattens the mascot body (the `d` of .nani-body in Nani.tsx) into a polygon of viewBox points. */
function bodyPolygon() {
  const points = [];
  const cubic = (p0, p1, p2, p3, steps = 24) => {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      points.push([
        u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
        u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
      ]);
    }
  };
  // M60 10 c28 0 50 19 50 44 s-22 44 -50 44 c-6 0 -12 -1 -17 -2.6 L22 106 c-3 1.5 -6 -1.5 -4.6 -4.5 l6 -14
  // C16 79.6 10 67.6 10 54 10 29 32 10 60 10 z
  points.push([60, 10]);
  cubic([60, 10], [88, 10], [110, 29], [110, 54]);
  cubic([110, 54], [110, 79], [88, 98], [60, 98]);
  cubic([60, 98], [54, 98], [48, 97], [43, 95.4]);
  points.push([22, 106]);
  cubic([22, 106], [19, 107.5], [16, 104.5], [17.4, 101.5]);
  points.push([23.4, 87.5]);
  cubic([23.4, 87.5], [16, 79.6], [10, 67.6], [10, 54]);
  cubic([10, 54], [10, 29], [32, 10], [60, 10]);
  return points;
}

const BODY_POLYGON = bodyPolygon();

function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const insideEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/** Distance from a point to the quadratic curve `M x0 y0 q cx cy x1 y1` (sampled), for the stroked smile. */
function nearQuadratic(x, y, [x0, y0], [cx, cy], [x1, y1], half) {
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    const qx = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const qy = u * u * y0 + 2 * u * t * cy + t * t * y1;
    if ((x - qx) ** 2 + (y - qy) ** 2 <= half ** 2) return true;
  }
  return false;
}

/** Color of the mascot at a point in viewBox coordinates, or null where the icon is transparent. */
function colorAt(x, y) {
  if (x < 10 || x > 110 || y < 10 || y > 107 || !insidePolygon(x, y, BODY_POLYGON)) return null; // bounding box first: cheap reject
  if (insideEllipse(x, y, 45, 50, 6, 8) || insideEllipse(x, y, 75, 50, 6, 8)) return INK;
  if (nearQuadratic(x, y, [50, 68], [60, 76], [70, 68], 2.2)) return INK; // smile (M50 68 q10 8 20 0), stroke 3.2 + margin
  if (insideEllipse(x, y, 36, 66, 7, 4) || insideEllipse(x, y, 84, 66, 7, 4)) return CHEEK;
  return BODY;
}

/** Returns size*size BGRA pixels, top row first. */
function renderPixels(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const color = colorAt(((px + (sx + 0.5) / SAMPLES) / size) * VIEWBOX, ((py + (sy + 0.5) / SAMPLES) / size) * VIEWBOX);
          if (!color) continue;
          covered++;
          sum[0] += color[0];
          sum[1] += color[1];
          sum[2] += color[2];
        }
      }
      if (covered === 0) continue;
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(sum[2] / covered);
      pixels[offset + 1] = Math.round(sum[1] / covered);
      pixels[offset + 2] = Math.round(sum[0] / covered);
      pixels[offset + 3] = Math.round((255 * covered) / (SAMPLES * SAMPLES));
    }
  }
  return pixels;
}

function dibImage(size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR image + AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const top = renderPixels(size);
  const xor = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row++) {
    top.copy(xor, (size - 1 - row) * size * 4, row * size * 4, (row + 1) * size * 4); // DIB rows are bottom-up
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size); // all zero: transparency comes from the alpha channel
  return Buffer.concat([header, xor, mask]);
}

/** @param {readonly number[]} sizes square sizes from 1 to 256 */
export function createIco(sizes) {
  const images = sizes.map((size) => {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`invalid icon size ${size}`);
    return dibImage(size);
  });
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    const size = sizes[index];
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}
