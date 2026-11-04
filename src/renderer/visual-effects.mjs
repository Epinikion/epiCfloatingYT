// The other tone must read this much better before the color switches, which
// keeps it from flickering on backgrounds between both.
const SWITCH_MARGIN = 1.25;

function linear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrast(a, b) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Relative luminance of the darkest and brightest tenth of a frame area, given
// as fractions of the frame. The frame arrives as BGRA from the main process.
export function areaLuminance(frame, { left = 0, right = 1, top = 0, bottom = 0.07 } = {}) {
  if (!frame?.pixels || !frame.width || !frame.height) return null;
  const pixels = new Uint8Array(frame.pixels);
  if (pixels.byteLength < frame.width * frame.height * 4) return null;
  const clamp = (value, size) => Math.max(0, Math.min(size, value));
  const x0 = clamp(Math.floor(left * frame.width), frame.width - 1);
  const x1 = clamp(Math.ceil(right * frame.width), frame.width);
  const y0 = clamp(Math.floor(top * frame.height), frame.height - 1);
  const y1 = clamp(Math.ceil(bottom * frame.height), frame.height);
  const values = [];
  for (let y = y0; y < Math.max(y1, y0 + 1); y += 1) {
    for (let x = x0; x < Math.max(x1, x0 + 1); x += 1) {
      const offset = (y * frame.width + x) * 4;
      values.push(0.0722 * linear(pixels[offset]) + 0.7152 * linear(pixels[offset + 1]) + 0.2126 * linear(pixels[offset + 2]));
    }
  }
  values.sort((a, b) => a - b);
  return { low: values[Math.floor((values.length - 1) * 0.1)], high: values[Math.ceil((values.length - 1) * 0.9)] };
}

// 'light' means a bright background and therefore dark foreground. Each tone is
// judged at the spot where it reads worst: light glyphs against the brightest
// tenth, dark glyphs against the darkest.
export function nextTone(previous, area, { light, dark }) {
  if (!area) return previous;
  const darkGlyphs = contrast(dark, area.low);
  const lightGlyphs = contrast(light, area.high);
  if (previous === 'light') return lightGlyphs > darkGlyphs * SWITCH_MARGIN ? 'dark' : 'light';
  return darkGlyphs > lightGlyphs * SWITCH_MARGIN ? 'light' : 'dark';
}

export const GLYPH_LUMINANCE = Object.freeze({
  button: { light: 0.604, dark: 0.012 },
  title: { light: 0.757, dark: 0.007 },
});

export class AmbientLight {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: true });
    this.source = document.createElement('canvas');
    this.sourceContext = this.source.getContext('2d', { alpha: false });
    this.hasVideoFrame = false;
  }

  paintWelcome() {
    const { width, height } = this.canvas;
    const gradient = this.context.createRadialGradient(width / 2, height * 0.44, 0, width / 2, height * 0.44, width * 0.72);
    gradient.addColorStop(0, '#ff5a3c');
    gradient.addColorStop(0.55, '#d02234');
    gradient.addColorStop(1, '#6e1220');
    this.context.globalAlpha = 1;
    this.context.fillStyle = gradient;
    this.context.fillRect(0, 0, width, height);
    this.hasVideoFrame = false;
  }

  update(frame, ignore = false) {
    if (ignore || !frame || frame.width !== 80 || frame.height !== 45 || !frame.pixels) return;
    const bgra = new Uint8Array(frame.pixels);
    if (bgra.byteLength !== frame.width * frame.height * 4) return;
    const rgba = new Uint8ClampedArray(bgra.byteLength);
    for (let offset = 0; offset < bgra.length; offset += 4) {
      rgba[offset] = bgra[offset + 2];
      rgba[offset + 1] = bgra[offset + 1];
      rgba[offset + 2] = bgra[offset];
      rgba[offset + 3] = 255;
    }

    this.source.width = frame.width;
    this.source.height = frame.height;
    this.sourceContext.putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);

    this.context.save();
    this.context.globalAlpha = this.hasVideoFrame ? 0.3 : 1;
    this.context.drawImage(
      this.source,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.context.restore();
    this.hasVideoFrame = true;
  }
}

export class ResizeSmoother {
  constructor(player, snapshot) {
    this.player = player;
    this.snapshot = snapshot;
    this.frozen = null;
    this.capture = null;
    this.generation = 0;
  }

  begin(isEmpty) {
    if (this.frozen || isEmpty) return;
    const rect = this.player.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const generation = ++this.generation;
    this.frozen = { width: rect.width, height: rect.height };
    this.player.style.width = `${rect.width}px`;
    this.player.style.height = `${rect.height}px`;
    this.player.classList.add('resize-frozen');
    this.capture = this.player.capturePage()
      .then((image) => generation === this.generation ? image.toDataURL() : null)
      .catch(() => null);
  }

  update(width, height) {
    if (!this.frozen) return;
    this.player.style.transform = `scale3d(${width / this.frozen.width}, ${height / this.frozen.height}, 1)`;
  }

  async end() {
    if (!this.frozen) return;
    const generation = this.generation;
    let dataUrl = null;
    try { dataUrl = await this.capture; } catch {}
    if (generation !== this.generation || !this.frozen) return;
    if (dataUrl) {
      this.snapshot.src = dataUrl;
      try { await this.snapshot.decode(); } catch {}
      if (generation !== this.generation) return;
      this.snapshot.hidden = false;
    }
    this.frozen = null;
    this.capture = null;
    this.player.classList.remove('resize-frozen');
    this.player.style.removeProperty('width');
    this.player.style.removeProperty('height');
    this.player.style.removeProperty('transform');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (generation !== this.generation) return;
    this.snapshot.hidden = true;
    this.snapshot.removeAttribute('src');
  }
}
