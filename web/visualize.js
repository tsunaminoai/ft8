// SPDX-License-Identifier: MIT
// Canvas helpers for FT8 visualization.

const TONE_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#f85149',
  '#bc8cff', '#39d353', '#ff7b72', '#79c0ff',
];

const BG = '#0d1117';
const TEXT_COLOR = '#8b949e';
const GRID_COLOR = '#30363d';

// Draw time-domain waveform (first maxSamples samples).
export function drawWaveform(canvas, f32Array, opts = {}) {
  const { color = '#58a6ff', maxSamples = 14400, label = '', sampleRate = 12000 } = opts;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const n = Math.min(maxSamples, f32Array.length);
  const mid = H / 2;

  // Auto-scale to peak amplitude so AWGN-inflated signals don't clip
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(f32Array[i]); if (a > peak) peak = a; }
  if (peak === 0) peak = 1;

  // Grid line at 0
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(W, mid);
  ctx.stroke();

  // Waveform
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = i / n * W;
    const y = mid - (f32Array[i] / peak) * (H * 0.45);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (label) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '11px monospace';
    ctx.fillText(label, 6, 14);
  }
}

// Draw FFT magnitude spectrum.
// magnitudes: Float32Array of amplitude values (linear), sampleRate for x-axis labels.
export function drawSpectrum(canvas, magnitudes, sampleRate, opts = {}) {
  const { xRange = [0, sampleRate / 2], label = 'Spectrum' } = opts;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const nyquist = sampleRate / 2;
  const [fMin, fMax] = xRange;
  const total = magnitudes.length;
  const binMin = Math.floor(fMin / nyquist * total);
  const binMax = Math.ceil(fMax / nyquist * total);

  let maxMag = 0;
  for (let b = binMin; b <= binMax; b++) {
    if (magnitudes[b] > maxMag) maxMag = magnitudes[b];
  }
  if (maxMag === 0) maxMag = 1;

  ctx.strokeStyle = '#58a6ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let b = binMin; b <= binMax; b++) {
    const x = (b - binMin) / (binMax - binMin) * W;
    const y = H - (magnitudes[b] / maxMag) * (H - 12);
    if (b === binMin) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '10px monospace';
  ctx.fillText(fMin + ' Hz', 4, H - 4);
  ctx.fillText(fMax + ' Hz', W - 60, H - 4);
  ctx.fillText(label, 4, 12);
}

// Draw 79-symbol frame as colored squares with Costas outlines.
export function drawSymbolFrame(canvas, symbols79, opts = {}) {
  const { squareSize = 18, gap = 2, highlightCostas = true } = opts;
  const ctx = canvas.getContext('2d');
  const cols = 79;
  const W = cols * (squareSize + gap) + gap;
  const H = 8 * (squareSize + gap) + gap + 20;
  canvas.width = Math.min(W, canvas.parentElement?.clientWidth || W);
  canvas.height = squareSize + gap * 2 + 24;

  const actualW = canvas.width;
  ctx.clearRect(0, 0, actualW, canvas.height);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, actualW, canvas.height);

  const scale = actualW / W;
  const sq = squareSize * scale;
  const gp = gap * scale;

  const COSTAS = [[0, 6], [36, 42], [72, 78]];

  for (let i = 0; i < symbols79.length; i++) {
    const tone = symbols79[i];
    const x = gp + i * (sq + gp);
    const y = gp;

    ctx.fillStyle = TONE_COLORS[tone];
    ctx.fillRect(x, y, sq, sq);

    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(8, sq * 0.5)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(String(tone), x + sq / 2, y + sq * 0.7);
  }
  ctx.textAlign = 'left';

  // Costas region outlines
  if (highlightCostas) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    for (const [start, end] of COSTAS) {
      const x = gp + start * (sq + gp) - 1;
      ctx.strokeRect(x, gp - 1, (end - start + 1) * (sq + gp), sq + 2);
    }
    ctx.setLineDash([]);
  }

  // Index labels
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `${Math.max(8, sq * 0.4)}px monospace`;
  ctx.fillText('0', gp, canvas.height - 4);
  ctx.fillText('78', gp + 78 * (sq + gp), canvas.height - 4);
}

// Draw bit array as colored squares grouped by fields.
// fields: [{label, start, end, color}]
export function drawBitField(canvas, bits, fields, opts = {}) {
  const { squareSize = 10, gap = 1 } = opts;
  const ctx = canvas.getContext('2d');
  const n = bits.length;
  const W = canvas.width;
  const sq = Math.max(4, Math.min(squareSize, (W - gap * (n + 1)) / n));
  const H = sq + gap * 2 + 20;
  canvas.height = H;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const fieldMap = new Array(n).fill(null);
  for (const f of fields) {
    for (let i = f.start; i <= f.end && i < n; i++) fieldMap[i] = f.color;
  }

  for (let i = 0; i < n; i++) {
    const x = gap + i * (sq + gap);
    const color = fieldMap[i] || (bits[i] ? '#58a6ff' : '#30363d');
    ctx.fillStyle = color;
    ctx.globalAlpha = bits[i] ? 1.0 : 0.35;
    ctx.fillRect(x, gap, sq, sq);
  }
  ctx.globalAlpha = 1.0;

  // Index marks
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '9px monospace';
  for (const f of fields) {
    const x = gap + f.start * (sq + gap);
    ctx.fillText(f.label, x, H - 2);
  }
}

// Create a scrolling waterfall display. Returns { update(freqData), stop() }.
export function createWaterfall(canvas, opts = {}) {
  const { colormap = 'viridis' } = opts;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let imageData = ctx.createImageData(W, H);
  let stopped = false;

  function update(freqData) {
    if (stopped) return;
    // Shift image up by 1 row
    const rowBytes = W * 4;
    imageData.data.copyWithin(0, rowBytes);

    // Write new bottom row
    const offset = (H - 1) * rowBytes;
    const n = freqData.length;
    let dbMin = -100, dbMax = -20;

    for (let x = 0; x < W; x++) {
      const bin = Math.floor(x / W * n);
      const val = (freqData[bin] - dbMin) / (dbMax - dbMin);
      const t = Math.max(0, Math.min(1, val));
      const [r, g, b] = heatColor(t);
      imageData.data[offset + x * 4] = r;
      imageData.data[offset + x * 4 + 1] = g;
      imageData.data[offset + x * 4 + 2] = b;
      imageData.data[offset + x * 4 + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function stop() { stopped = true; }
  return { update, stop };
}

// Draw LLR color bar (174 values).
export function drawLLRBar(canvas, llrArray, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const n = llrArray.length;
  const sq = W / n;
  const maxAbs = Math.max(...llrArray.map(Math.abs), 0.1);

  for (let i = 0; i < n; i++) {
    const v = llrArray[i] / maxAbs;
    const x = i * sq;
    if (v > 0) {
      ctx.fillStyle = `rgba(88,166,255,${Math.min(1, v)})`;
    } else {
      ctx.fillStyle = `rgba(248,81,73,${Math.min(1, -v)})`;
    }
    ctx.fillRect(x, 0, sq, H);
  }

  // Parity region marker
  ctx.strokeStyle = '#d29922';
  ctx.lineWidth = 2;
  const x91 = 91 * sq;
  ctx.beginPath();
  ctx.moveTo(x91, 0);
  ctx.lineTo(x91, H);
  ctx.stroke();

  ctx.fillStyle = '#d29922';
  ctx.font = '10px monospace';
  ctx.fillText('91', x91 + 2, 12);
}

function heatColor(t) {
  const r = Math.floor(Math.min(255, t * 2 * 255));
  const g = Math.floor(Math.min(255, Math.max(0, (t - 0.5) * 2 * 255)));
  const b = Math.floor(Math.max(0, (0.5 - t) * 2 * 255));
  return [r, g, b];
}
