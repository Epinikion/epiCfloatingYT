'use strict';

const GLOW_MARGIN = 0.075;
const GLOW_SCALE = 1 + GLOW_MARGIN * 2;
const DEFAULT_ASPECT = 16 / 9;
const MIN_LONG_EDGE = 240;
const MIN_SHORT_EDGE = 90;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAspect(value, fallback = DEFAULT_ASPECT) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(clamp(numeric, 0.4, 3).toFixed(6)) : fallback;
}

function minimumVideoSize(aspect) {
  const ratio = normalizeAspect(aspect);
  return ratio >= 1
    ? { width: MIN_LONG_EDGE, height: Math.max(MIN_SHORT_EDGE, Math.round(MIN_LONG_EDGE / ratio)) }
    : { width: Math.max(MIN_SHORT_EDGE, Math.round(MIN_LONG_EDGE * ratio)), height: MIN_LONG_EDGE };
}

function outerScale(glow) {
  return glow ? GLOW_SCALE : 1;
}

function minimumWindowSize(aspect, glow) {
  const minimum = minimumVideoSize(aspect);
  const scale = outerScale(glow);
  return { width: Math.round(minimum.width * scale), height: Math.round(minimum.height * scale) };
}

function videoRect(bounds, aspect, glow) {
  const scale = outerScale(glow);
  const availableWidth = Math.max(1, Math.round(bounds.width / scale));
  const availableHeight = Math.max(1, Math.round(bounds.height / scale));
  const ratio = normalizeAspect(aspect);
  let width = availableWidth;
  let height = Math.round(width / ratio);
  if (height > availableHeight) {
    height = availableHeight;
    width = Math.round(height * ratio);
  }
  return {
    x: bounds.x + Math.round((bounds.width - width) / 2),
    y: bounds.y + Math.round((bounds.height - height) / 2),
    width,
    height,
  };
}

function reshapeForAspect(bounds, aspect, glow, workArea) {
  const ratio = normalizeAspect(aspect);
  const scale = outerScale(glow);
  let videoHeight = Math.max(1, bounds.height / scale);
  let videoWidth = videoHeight * ratio;
  const minimum = minimumVideoSize(ratio);
  const growth = Math.max(1, minimum.width / videoWidth, minimum.height / videoHeight);
  videoWidth *= growth;
  videoHeight *= growth;

  let width = Math.round(videoWidth * scale);
  let height = Math.round(videoHeight * scale);
  const fit = Math.min(1, (workArea.width * 0.94) / width, (workArea.height * 0.94) / height);
  width = Math.max(1, Math.round(width * fit));
  height = Math.max(1, Math.round(height * fit));

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    x: clamp(Math.round(centerX - width / 2), workArea.x, workArea.x + workArea.width - width),
    y: clamp(Math.round(centerY - height / 2), workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  };
}

function resizeFromDirection({ start, direction, cursorX, cursorY, originX, originY, aspect, glow, lockAspect }) {
  const dx = cursorX - originX;
  const dy = cursorY - originY;
  const startRight = start.x + start.width;
  const startBottom = start.y + start.height;
  let width = start.width + (direction.includes('e') ? dx : direction.includes('w') ? -dx : 0);
  let height = start.height + (direction.includes('s') ? dy : direction.includes('n') ? -dy : 0);
  const minimum = minimumWindowSize(aspect, glow);

  if (lockAspect) {
    const horizontalOnly = /^[ew]$/.test(direction);
    const verticalOnly = /^[ns]$/.test(direction);
    if (horizontalOnly || (!verticalOnly && Math.abs(dx / start.width) >= Math.abs(dy / start.height))) {
      width = Math.max(minimum.width, width);
      height = Math.round(width / normalizeAspect(aspect));
    } else {
      height = Math.max(minimum.height, height);
      width = Math.round(height * normalizeAspect(aspect));
    }
  }

  width = Math.max(minimum.width, Math.round(width));
  height = Math.max(minimum.height, Math.round(height));
  let x = direction.includes('w') ? startRight - width : start.x;
  let y = direction.includes('n') ? startBottom - height : start.y;
  if (/^[ns]$/.test(direction)) x = Math.round(start.x + (start.width - width) / 2);
  if (/^[ew]$/.test(direction)) y = Math.round(start.y + (start.height - height) / 2);
  return { x, y, width, height };
}

function displayGridStep(scaleFactor) {
  for (let step = 1; step <= 8; step += 1) {
    if (Math.abs(step * scaleFactor - Math.round(step * scaleFactor)) < 1e-6) return step;
  }
  return 1;
}

function snapBounds(bounds, scaleFactor) {
  const step = displayGridStep(scaleFactor);
  const snap = (value) => Math.round(value / step) * step;
  return {
    x: snap(bounds.x),
    y: snap(bounds.y),
    width: Math.max(step, snap(bounds.width)),
    height: Math.max(step, snap(bounds.height)),
  };
}

module.exports = {
  DEFAULT_ASPECT,
  GLOW_MARGIN,
  GLOW_SCALE,
  normalizeAspect,
  minimumVideoSize,
  minimumWindowSize,
  outerScale,
  videoRect,
  reshapeForAspect,
  resizeFromDirection,
  displayGridStep,
  snapBounds,
};

