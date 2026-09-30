import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

export function decode(path) {
  const b = readFileSync(path);
  let o = 8, ihdr = null; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8);
    if (t === 'IHDR') ihdr = { w: b.readUInt32BE(o + 8), h: b.readUInt32BE(o + 12), depth: b[o + 16], ct: b[o + 17] };
    if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const { w, h, ct } = ihdr;
  const ch = ct === 2 ? 3 : ct === 6 ? 4 : ct === 0 ? 1 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  const pa = (a, b2) => (a + b2) & 0xff;
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, bb = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v = pa(v, a);
      else if (ft === 2) v = pa(v, bb);
      else if (ft === 3) v = pa(v, (a + bb) >> 1);
      else if (ft === 4) { const p = a + bb - c, da = Math.abs(p - a), db = Math.abs(p - bb), dc = Math.abs(p - c); v = pa(v, da <= db && da <= dc ? a : db <= dc ? bb : c); }
      cur[i] = v;
    }
  }
  return { w, h, ch, px };
}

/**
 * Write RGBA (ct 6). Adaptive per-scanline filtering — gradient art compresses
 * roughly twice as well under Paeth as under no filter, and these files load on
 * every page.
 */
export function encodeRGBA(path, w, h, data) {
  const stride = w * 4, BPP = 4;
  const raw = Buffer.alloc(h * (stride + 1));
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < h; y++) {
    const cur = data.subarray(y * stride, (y + 1) * stride);
    const prev = y ? data.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= BPP ? cur[i - BPP] : 0, b = prev[i], c = i >= BPP ? prev[i - BPP] : 0;
      cand[0][i] = cur[i];
      cand[1][i] = (cur[i] - a) & 0xff;
      cand[2][i] = (cur[i] - b) & 0xff;
      cand[3][i] = (cur[i] - ((a + b) >> 1)) & 0xff;
      const pp = a + b - c, da = Math.abs(pp - a), db = Math.abs(pp - b), dc = Math.abs(pp - c);
      cand[4][i] = (cur[i] - (da <= db && da <= dc ? a : db <= dc ? b : c)) & 0xff;
    }
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) { const v = cand[f][i]; sum += v < 128 ? v : 256 - v; }
      if (sum < bestScore) { bestScore = sum; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const mk = (type, payload) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(mk('IHDR', ihdr));
  chunks.push(mk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9, strategy: zlib.constants.Z_DEFAULT_STRATEGY })));
  chunks.push(mk('IEND', Buffer.alloc(0)));
  writeFileSync(path, Buffer.concat(chunks));
}

let TAB = null;
function crc32(buf) {
  if (!TAB) { TAB = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TAB[n] = c; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TAB[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
