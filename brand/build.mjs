/**
 * Rebuild the web logo assets from the supplied artwork.
 *
 *   node brand/build.mjs
 *
 * The source is `brand/logo-source.png` — the logo as delivered, printed on an
 * off-white card. The outputs are committed too; this exists so they can be
 * regenerated when the artwork changes, rather than being binaries nobody can
 * reproduce.
 *
 * The source is dark/saturated art printed on an off-white card. Everything
 * here follows from that: the card is keyed to transparency so the mark sits on
 * either theme, and a lightened variant is derived for the dark palette, where
 * the navy half of the wordmark would otherwise disappear.
 */
import { decode, encodeRGBA } from './png.mjs';

const SRC = new URL('./logo-source.png', import.meta.url).pathname;
const OUT = new URL('../app/', import.meta.url).pathname;

const { w: SW, h: SH, ch, px } = decode(SRC);

/** Card white, measured: the printed ground sits at 247-253 per channel. */
const GROUND = 251;
/** Below this the pixel is card, not ink. Measured max background: 0.067. */
const KNEE = 0.09;

/** Key the card to transparency, un-premultiplying against the printed ground. */
function keyed() {
  const out = Buffer.alloc(SW * SH * 4);
  for (let i = 0, o = 0; i < SW * SH; i++, o += 4) {
    const r = px[i * ch], g = px[i * ch + 1], b = px[i * ch + 2];
    const raw = 1 - Math.min(r, g, b) / 255;
    const a = Math.max(0, Math.min(1, (raw - KNEE) / (1 - KNEE)));
    if (a <= 0) continue;
    const un = (c) => Math.max(0, Math.min(255, Math.round((c - GROUND * (1 - a)) / a)));
    out[o] = un(r); out[o + 1] = un(g); out[o + 2] = un(b); out[o + 3] = Math.round(a * 255);
  }
  return out;
}

function crop(src, sw, x, y, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let j = 0; j < h; j++) src.copy(out, j * w * 4, ((y + j) * sw + x) * 4, ((y + j) * sw + x + w) * 4);
  return out;
}

/** Box-filter downscale. Averaged in premultiplied alpha or edges gain halos. */
function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
        const o = (j * sw + i) * 4, av = src[o + 3] / 255;
        r += src[o] * av; g += src[o + 1] * av; b += src[o + 2] * av; a += src[o + 3]; n++;
      }
      const o = (y * dw + x) * 4, am = a / n;
      out[o + 3] = Math.round(am);
      if (am > 0) {
        const k = n * (am / 255);
        out[o] = Math.min(255, Math.round(r / k)); out[o + 1] = Math.min(255, Math.round(g / k)); out[o + 2] = Math.min(255, Math.round(b / k));
      }
    }
  }
  return out;
}

/**
 * Lift the artwork onto a dark ground.
 *
 * Hue is the brand and does not move. Lightness is remapped into a band, and
 * saturation is pulled back, because a colour that keeps full chroma while
 * gaining lightness turns neon rather than light.
 *
 * Two grounds need two bands. `DARK` targets the app's #16161a canvas, where
 * the navy half of the wordmark would otherwise vanish. `PANEL` targets the
 * signed-out brand panel, which is itself navy — there the ordinary dark
 * variant lands too close to its own background, so the band starts higher and
 * keeps more chroma to hold "FinMan" and "AI" apart as two colours.
 */
const DARK = { base: 0.42, span: 0.55, sat: 0.72 };
const PANEL = { base: 0.6, span: 0.34, sat: 0.75 };

function lighten(src, { base, span, sat: satScale } = DARK) {
  const out = Buffer.from(src);
  for (let o = 0; o < out.length; o += 4) {
    if (out[o + 3] === 0) continue;
    const r = out[o] / 255, g = out[o + 1] / 255, b = out[o + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const l = (mx + mn) / 2;
    const nl = base + span * l;
    if (d === 0) {
      const v = Math.round(nl * 255);
      out[o] = v; out[o + 1] = v; out[o + 2] = v;
      continue;
    }
    const s = Math.min(1, (l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)) * satScale);
    let h;
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s;
    const p2 = 2 * nl - q;
    const hue = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p2 + (q - p2) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p2 + (q - p2) * (2 / 3 - t) * 6;
      return p2;
    };
    out[o] = Math.round(hue(h + 1 / 3) * 255);
    out[o + 1] = Math.round(hue(h) * 255);
    out[o + 2] = Math.round(hue(h - 1 / 3) * 255);
  }
  return out;
}

/** Flatten onto an opaque rounded square — iOS and most tab bars want a ground. */
function onWhiteSquare(src, sw, sh, size, inset, radius) {
  const inner = size - inset * 2;
  const scale = Math.min(inner / sw, inner / sh);
  const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
  const art = resize(src, sw, sh, dw, dh);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
    let cov = 1;
    if (cx < radius && cy < radius) {
      const d = Math.hypot(radius - cx, radius - cy);
      cov = Math.max(0, Math.min(1, radius - d + 0.5));
    }
    out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = Math.round(cov * 255);
  }
  const ox = Math.round((size - dw) / 2), oy = Math.round((size - dh) / 2);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const s = (y * dw + x) * 4, d = ((oy + y) * size + ox + x) * 4, a = art[s + 3] / 255;
    if (a === 0) continue;
    out[d] = Math.round(art[s] * a + out[d] * (1 - a));
    out[d + 1] = Math.round(art[s + 1] * a + out[d + 1] * (1 - a));
    out[d + 2] = Math.round(art[s + 2] * a + out[d + 2] * (1 - a));
  }
  return out;
}

const all = keyed();

// Measured ink bounds in the source, plus a little optical breathing room.
const LOCKUP = { x: 280, y: 106, w: 464, h: 360 };   // emblem + wordmark + tagline
const MARK   = { x: 359, y: 106, w: 308, h: 235 };   // emblem alone

const lockup = crop(all, SW, LOCKUP.x, LOCKUP.y, LOCKUP.w, LOCKUP.h);
const mark = crop(all, SW, MARK.x, MARK.y, MARK.w, MARK.h);

encodeRGBA(`${OUT}/public/logo.png`, LOCKUP.w, LOCKUP.h, lockup);
encodeRGBA(`${OUT}/public/logo-dark.png`, LOCKUP.w, LOCKUP.h, lighten(lockup));
encodeRGBA(`${OUT}/public/logo-panel.png`, LOCKUP.w, LOCKUP.h, lighten(lockup, PANEL));
// The nav renders the mark at 26px. 160px covers a 3x display with room to
// spare; shipping the full 308px crop was six times the pixels for no gain.
const NAV_W = 160, NAV_H = Math.round((MARK.h * NAV_W) / MARK.w);
const navMark = resize(mark, MARK.w, MARK.h, NAV_W, NAV_H);
encodeRGBA(`${OUT}/public/logo-mark.png`, NAV_W, NAV_H, navMark);
encodeRGBA(`${OUT}/public/logo-mark-dark.png`, NAV_W, NAV_H, lighten(navMark));
encodeRGBA(`${OUT}/src/app/icon.png`, 256, 256, onWhiteSquare(mark, MARK.w, MARK.h, 256, 18, 46));
encodeRGBA(`${OUT}/src/app/apple-icon.png`, 180, 180, onWhiteSquare(mark, MARK.w, MARK.h, 180, 14, 0));

console.log('wrote logo.png, logo-dark.png, logo-panel.png, logo-mark.png, logo-mark-dark.png, icon.png, apple-icon.png');
