export class AmbientLight {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: true });
    this.source = document.createElement('canvas');
    this.sourceContext = this.source.getContext('2d', { alpha: false });
    this.hasVideoFrame = false;
    this.crop = { x: 0, y: 0, width: 80, height: 45 };
    this.candidateKey = '';
    this.candidateHits = 0;
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
    const candidate = this.#detectContent(rgba, frame.width, frame.height);
    const key = `${candidate.x},${candidate.y},${candidate.width},${candidate.height}`;
    if (key === this.candidateKey) this.candidateHits += 1;
    else {
      this.candidateKey = key;
      this.candidateHits = 1;
    }
    if (this.candidateHits >= 3) this.crop = candidate;

    const inset = 1;
    this.context.save();
    this.context.globalAlpha = this.hasVideoFrame ? 0.3 : 1;
    this.context.drawImage(
      this.source,
      this.crop.x + inset,
      this.crop.y + inset,
      Math.max(1, this.crop.width - inset * 2),
      Math.max(1, this.crop.height - inset * 2),
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.context.restore();
    this.hasVideoFrame = true;
  }

  #detectContent(pixels, width, height) {
    const activeRow = (y) => {
      let lit = 0;
      const begin = Math.floor(width * 0.1);
      const end = Math.ceil(width * 0.9);
      for (let x = begin; x < end; x += 1) {
        const offset = (y * width + x) * 4;
        if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 22) lit += 1;
      }
      return lit / Math.max(1, end - begin) > 0.16;
    };
    const activeColumn = (x) => {
      let lit = 0;
      const begin = Math.floor(height * 0.1);
      const end = Math.ceil(height * 0.9);
      for (let y = begin; y < end; y += 1) {
        const offset = (y * width + x) * 4;
        if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 22) lit += 1;
      }
      return lit / Math.max(1, end - begin) > 0.16;
    };

    let top = 0, bottom = 0, left = 0, right = 0;
    while (top < Math.floor(height * 0.24) && !activeRow(top)) top += 1;
    while (bottom < Math.floor(height * 0.24) && !activeRow(height - 1 - bottom)) bottom += 1;
    while (left < Math.floor(width * 0.42) && !activeColumn(left)) left += 1;
    while (right < Math.floor(width * 0.42) && !activeColumn(width - 1 - right)) right += 1;
    const yInset = top > 1 && bottom > 1 && Math.abs(top - bottom) <= 2 ? Math.min(top, bottom) : 0;
    const xInset = left > 1 && right > 1 && Math.abs(left - right) <= 3 ? Math.min(left, right) : 0;
    return { x: xInset, y: yInset, width: width - xInset * 2, height: height - yInset * 2 };
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

