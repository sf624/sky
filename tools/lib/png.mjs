// PNG reading and writing (8-bit RGB and RGBA, as Chrome's screenshots are), and picture differences.
import fs from 'node:fs';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Returns { w, h, rgb: Uint8Array of w * h * 3 }. The alpha of RGBA files is dropped (screenshots are opaque).
export function readPng(fileOrBuffer) {
  const buf = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : fs.readFileSync(fileOrBuffer);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let w = 0, h = 0, type = 0;
  const idat = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), kind = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      type = data[9];
      if (data[8] !== 8 || (type !== 2 && type !== 6) || data[12] !== 0) throw new Error('only 8-bit RGB or RGBA PNGs without interlacing');
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = type === 6 ? 4 : 3, stride = w * bpp;
  const px = new Uint8Array(h * stride);
  // Undo the filter of each row (PNG spec, section 9).
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p0 = a + b - c, pa = Math.abs(p0 - a), pb = Math.abs(p0 - b), pc = Math.abs(p0 - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[dst + x] = v;
    }
  }
  if (bpp === 3) return { w, h, rgb: px };
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
  return { w, h, rgb };
}

const chunk = (kind, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(kind, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
  return Buffer.concat([head, data, crc]);
};

// Writes an 8-bit RGB picture (no filters: these files are for looking at, not for keeping).
export function writePng(file, { w, h, rgb }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  fs.writeFileSync(file, Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

export const crop = (img, [x, y, w, h]) => {
  const rgb = new Uint8Array(w * h * 3);
  for (let r = 0; r < h; r++) rgb.set(img.rgb.subarray(((y + r) * img.w + x) * 3, ((y + r) * img.w + x + w) * 3), r * w * 3);
  return { w, h, rgb };
};

// Differences of two pictures of one size, in 8-bit levels: mean and max over all channels, and the share of
// pixels (%) whose largest channel difference is over 2 and over 8. With out, also writes |a - b| * gain.
export function diffPng(a, b, { box, out, gain = 8 } = {}) {
  if (!a.rgb) a = readPng(a);
  if (!b.rgb) b = readPng(b);
  if (box) { a = crop(a, box); b = crop(b, box); }
  if (a.w !== b.w || a.h !== b.h) throw new Error(`sizes differ: ${a.w}x${a.h} and ${b.w}x${b.h}`);
  let sum = 0, max = 0, over2 = 0, over8 = 0;
  const d = new Uint8Array(a.rgb.length);
  for (let i = 0; i < a.rgb.length; i += 3) {
    let m = 0;
    for (let k = 0; k < 3; k++) {
      const v = Math.abs(a.rgb[i + k] - b.rgb[i + k]);
      sum += v;
      if (v > m) m = v;
      d[i + k] = Math.min(255, v * gain);
    }
    if (m > max) max = m;
    if (m > 2) over2++;
    if (m > 8) over8++;
  }
  const n = a.w * a.h;
  if (out) writePng(out, { w: a.w, h: a.h, rgb: d });
  return { mean: +(sum / a.rgb.length).toFixed(3), max, over2: +(over2 / n * 100).toFixed(3), over8: +(over8 / n * 100).toFixed(3) };
}
export const fmtDiff = (d) => `mean ${d.mean} max ${d.max} >2: ${d.over2}% >8: ${d.over8}%`;

// How far the content of a moved to in b (dx, dy in pixels, within +-r), inside box: the shift with the smallest
// mean difference of grey levels, searched on every pixel. Used to tell a jump of the picture from noise.
export function shiftOf(a, b, box, r = 6) {
  if (!a.rgb) a = readPng(a);
  if (!b.rgb) b = readPng(b);
  const [x0, y0, w, h] = box;
  const grey = (img) => {
    const g = new Float32Array(img.w * img.h);
    for (let i = 0; i < g.length; i++) g[i] = img.rgb[3 * i] + img.rgb[3 * i + 1] + img.rgb[3 * i + 2];
    return g;
  };
  const ga = grey(a), gb = grey(b);
  let best = [0, 0], bestErr = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      let e = 0;
      for (let y = y0; y < y0 + h; y += 2) {
        for (let x = x0; x < x0 + w; x += 2) e += Math.abs(ga[y * a.w + x] - gb[(y + dy) * b.w + x + dx]);
      }
      if (e < bestErr) { bestErr = e; best = [dx, dy]; }
    }
  }
  return best;
}
