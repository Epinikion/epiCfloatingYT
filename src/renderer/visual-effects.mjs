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
