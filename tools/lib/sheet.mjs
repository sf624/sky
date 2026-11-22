// A contact sheet: rows of pictures, each scaled to a fixed width, with a label over each row, as one RGB
// picture (for writePng). The labels use a 5 x 7 pixel font: each glyph is its character, then its 7 rows,
// top first, each 5 bits written as one base-32 digit (the leftmost pixel is the highest bit).
const FONT = 'a00e1fhf bggmphhu c00egghe d11djhhf e00ehvge f698s888 g0fhhf1e hggmphhh i40c444e j20622ic kggikoki '
  + 'lc44444e m00qllhh n00mphhh o00ehhhe p00uhugg q00djf11 r00mpggg s00ege1u t88s8896 u00hhhjd v00hhha4 w00hhlla '
  + 'x00ha4ah y00hhf1e z00v248v 0ehjlphe 14c4444e 2eh1248v 3v2421he 426aiv22 5vgu11he 668guhhe 7v124888 8ehhehhe '
  + '9ehhf12c .00000cc -000v000 _000000v |4444444 (2488842 )8422248 /122488g ,0000c48 +044v440 :0cc0cc0';
const GLYPHS = Object.fromEntries(FONT.split(' ').map((g) => [g[0], [...g.slice(1)].map((d) => parseInt(d, 32))]));
GLYPHS[' '] = [0, 0, 0, 0, 0, 0, 0];

// Nearest-neighbour shrink (or grow) of an { w, h, rgb } picture to width w (box mean when shrinking by 2 or more).
export function scale(img, w) {
  const h = Math.round(img.h * w / img.w), rgb = new Uint8Array(w * h * 3), k = img.w / w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * k), y0 = Math.floor(y * k), n = Math.max(1, Math.floor(k));
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) s += img.rgb[((Math.min(img.h - 1, y0 + j)) * img.w + Math.min(img.w - 1, x0 + i)) * 3 + c];
        rgb[(y * w + x) * 3 + c] = s / (n * n);
      }
    }
  }
  return { w, h, rgb };
}

function text(out, s, x0, y0, px = 2) {
  let x = x0;
  for (const ch of s.toLowerCase()) {
    const g = GLYPHS[ch] ?? GLYPHS['.'];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (!((g[r] >> (4 - c)) & 1)) continue;
        for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
          const X = x + c * px + i, Y = y0 + r * px + j;
          if (X < out.w && Y < out.h) out.rgb.set([235, 235, 235], (Y * out.w + X) * 3);
        }
      }
    }
    x += 6 * px;
  }
}

// rows: [{ label, images: [{ w, h, rgb }, ...] }]. Each picture is scaled to cell px wide.
export function sheet(rows, { cell = 640, gap = 6, head = 22 } = {}) {
  const cols = Math.max(...rows.map((r) => r.images.length));
  const scaled = rows.map((r) => r.images.map((im) => scale(im, cell)));
  const heights = scaled.map((imgs) => Math.max(...imgs.map((im) => im.h)));
  const w = cols * cell + (cols + 1) * gap, h = heights.reduce((a, b) => a + b + head + gap, gap);
  const out = { w, h, rgb: new Uint8Array(w * h * 3).fill(34) };
  let y = gap;
  rows.forEach((r, k) => {
    text(out, r.label, gap, y + 4);
    y += head;
    scaled[k].forEach((im, c) => {
      const x = gap + c * (cell + gap);
      for (let j = 0; j < im.h; j++) out.rgb.set(im.rgb.subarray(j * im.w * 3, (j + 1) * im.w * 3), ((y + j) * w + x) * 3);
    });
    y += heights[k] + gap;
  });
  return out;
}
