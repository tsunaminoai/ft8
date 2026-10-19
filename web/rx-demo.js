// SPDX-License-Identifier: MIT
// RX pipeline step-card controller.

import * as viz from './visualize.js';
import * as audio from './audio.js';

let wasm = null;

export function initRx(wasmExports) {
  wasm = wasmExports;
  buildRxSteps();
}

const PRESETS = [
  { label: 'CQ W9XYZ EN50', msg: 'CQ W9XYZ EN50' },
  { label: 'DE K1JT K9ABC -10', msg: 'DE K1JT K9ABC' },
  { label: 'Free text: HELLO', msg: 'HELLO' },
];

const rxState = {
  pcm: null,
  llr: null,
  bits174: null,
  bits91: null,
  bits77: null,
};

// ── WASM memory helpers ──────────────────────────────────────────

function wasmAlloc(n) {
  const ptr = wasm.alloc(n);
  if (!ptr) throw new Error('WASM alloc failed');
  return ptr;
}

function wasmWriteStr(str) {
  const bytes = new TextEncoder().encode(str);
  const ptr = wasmAlloc(bytes.length);
  new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function wasmReadU8(ptr, len) {
  return new Uint8Array(wasm.memory.buffer, ptr, len).slice();
}

// ── Build steps ──────────────────────────────────────────────────

function buildRxSteps() {
  const container = document.getElementById('rx-steps');
  if (!container) return;
  container.innerHTML = '';

  const resetRow = document.createElement('div');
  resetRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:10px';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'secondary';
  resetBtn.textContent = '↺ Start Over';
  resetBtn.addEventListener('click', () => {
    rxState.pcm = null; rxState.llr = null;
    rxState.bits174 = null; rxState.bits91 = null; rxState.bits77 = null;
    buildRxSteps();
  });
  resetRow.appendChild(resetBtn);
  container.appendChild(resetRow);

  const steps = [buildRx1(), buildRx2(), buildRx3(), buildRx4(), buildRx5(), buildRx6()];
  steps.forEach(s => container.appendChild(s));
  activateStep(0, steps);
}

function makeCard(num, title, badge, bodyFn) {
  const card = document.createElement('div');
  card.className = 'step-card';
  card.setAttribute('data-step', num);
  const header = document.createElement('div');
  header.className = 'step-header';
  header.innerHTML = `
    <div class="step-num">${num}</div>
    <div class="step-title">${title}</div>
    <div class="step-badge">${badge}</div>
  `;
  const body = document.createElement('div');
  body.className = 'step-body';
  bodyFn(body);
  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function activateStep(idx, steps) {
  steps.forEach((s, i) => {
    s.classList.toggle('active', i === idx);
    if (i < idx) s.classList.add('done');
  });
}

// ── Step 1: Audio Input ───────────────────────────────────────────

let rx1El = null;
function buildRx1() {
  rx1El = makeCard(1, 'Audio Input', 'PCM signal', body => {
    body.innerHTML = `
      <p class="step-desc">Choose a pre-built signal to decode, or use your microphone to capture a live FT8 transmission. <strong>To try it live:</strong> open the TX Pipeline in another browser window, click Play, then click Start Recording here. <em>Timing note:</em> FT8 stations transmit on 15-second UTC boundaries; the recorder captures two frame-lengths and aligns automatically using the Costas sync marker.</p>
      <div class="mb-12">
        <label>Input source</label>
        <select id="rx-source">
          <option value="preset">Synthesized preset</option>
          <option value="mic">Microphone</option>
          <option value="upload" disabled>Upload WAV (coming soon)</option>
        </select>
      </div>
      <div id="rx-preset-wrap">
        <label>Preset message</label>
        <select id="rx-preset">
          ${PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('')}
        </select>
      </div>
      <div id="rx-noise-wrap" class="my-12">
        <label>SNR: <span id="rx-snr-val">-10 dB</span></label>
        <input type="range" id="rx-snr" min="-20" max="0" step="1" value="-10"
               aria-label="Signal to noise ratio in dB">
      </div>
      <button id="rx-step1-go">Synthesize + Add Noise →</button>
      <div id="rx-mic-wrap" style="display:none">
        <button id="rx-mic-btn">Start Recording</button>
        <div id="rx-mic-progress" class="mt-8" style="display:none">
          <div>Listening&#8230; <span id="rx-mic-time">25.3</span> s - will stop early when signal found</div>
          <progress id="rx-mic-bar" value="0" max="303360" style="width:100%;margin-top:6px"></progress>
        </div>
      </div>
      <div class="canvas-wrap mt-12">
        <figure>
          <canvas id="rx-canvas-waveform" width="860" height="100" aria-label="Received signal waveform"></canvas>
          <figcaption>Received signal waveform</figcaption>
        </figure>
      </div>
      <div class="mt-8">
        <button id="rx-play-btn" disabled>▶ Play</button>
        <button id="rx-stop-btn" class="secondary" disabled>■ Stop</button>
      </div>
    `;

    body.querySelector('#rx-source').addEventListener('change', function() {
      const isMic = this.value === 'mic';
      const isPreset = this.value === 'preset';
      body.querySelector('#rx-preset-wrap').style.display = isPreset ? '' : 'none';
      body.querySelector('#rx-noise-wrap').style.display = isPreset ? '' : 'none';
      body.querySelector('#rx-step1-go').style.display = isPreset ? '' : 'none';
      body.querySelector('#rx-mic-wrap').style.display = isMic ? '' : 'none';
    });

    body.querySelector('#rx-snr').addEventListener('input', function() {
      body.querySelector('#rx-snr-val').textContent = this.value + ' dB';
    });

    body.querySelector('#rx-step1-go').addEventListener('click', () => runRx1(body));
    body.querySelector('#rx-mic-btn').addEventListener('click', () => runRx1Mic(body));

    body.querySelector('#rx-play-btn').addEventListener('click', () => {
      if (rxState.pcm) audio.playPCM(rxState.pcm, 12000);
    });
    body.querySelector('#rx-stop-btn').addEventListener('click', () => audio.stopPlayback());
  });
  return rx1El;
}

function runRx1(body) {
  const presetIdx = parseInt(body.querySelector('#rx-preset').value, 10);
  const msg = PRESETS[presetIdx].msg;
  const snrDb = parseInt(body.querySelector('#rx-snr').value, 10);

  // Synthesize via WASM
  const PCM_LEN = 151680;
  const pcmPtr = wasmAlloc(PCM_LEN * 4);
  const { ptr: tPtr, len: tLen } = wasmWriteStr(msg);
  wasm.encode_freetext_to_audio(tPtr, tLen, 1500.0, pcmPtr);
  wasm.free(tPtr, tLen);

  const rawBytes = new Uint8Array(wasm.memory.buffer, pcmPtr, PCM_LEN * 4).slice();
  rxState.pcm = new Float32Array(rawBytes.buffer, 0, PCM_LEN);
  wasm.free(pcmPtr, PCM_LEN * 4);
  wasm.arena_reset();

  if (snrDb < 0) {
    audio.addAWGN(rxState.pcm, snrDb);
  }

  const canvas = body.querySelector('#rx-canvas-waveform');
  if (canvas) viz.drawWaveform(canvas, rxState.pcm, { maxSamples: 14400, color: '#3fb950' });

  body.querySelector('#rx-play-btn').disabled = false;
  body.querySelector('#rx-stop-btn').disabled = false;
  rx1El.classList.add('done');
  triggerRx2();
}

async function runRx1Mic(body) {
  const FRAME_LEN = 151680;
  const MAX_LEN = 303360;
  const stopRef = { stop: false, buffer: null, pos: 0 };

  const btn = body.querySelector('#rx-mic-btn');
  const progressEl = body.querySelector('#rx-mic-progress');
  const timeEl = body.querySelector('#rx-mic-time');
  const bar = body.querySelector('#rx-mic-bar');

  btn.disabled = true;
  btn.textContent = 'Requesting permission…';
  bar.max = MAX_LEN;
  progressEl.style.display = '';

  let decoding = false;
  let earlyDone = false;

  const poll = setInterval(async () => {
    if (decoding || earlyDone || stopRef.stop || !stopRef.buffer) return;
    const pos = stopRef.pos;
    if (pos < FRAME_LEN) return;
    decoding = true;
    try {
      const slice = stopRef.buffer.slice(0, pos);
      const t0 = findFrameStart(slice);
      const frame = slice.slice(t0, t0 + FRAME_LEN);
      if (frame.length < FRAME_LEN) return;
      const llr = computeLLRsForFrame(frame);
      const { bits174, ok } = ldpcCheckQuiet(llr);
      if (ok) {
        earlyDone = true;
        stopRef.stop = true;
        clearInterval(poll);
        rxState.pcm = frame;
        rxState.llr = llr;
        rxState.bits174 = bits174;
        btn.textContent = '✓ Signal found early!';
        bar.value = bar.max;
        finalizeMicCapture(body);
      }
    } finally {
      decoding = false;
    }
  }, 1500);

  let capturedPcm;
  try {
    capturedPcm = await audio.captureMic(MAX_LEN, (pos, total) => {
      bar.value = pos;
      timeEl.textContent = ((total - pos) / 12000).toFixed(1);
    }, stopRef);
  } catch (err) {
    clearInterval(poll);
    btn.disabled = false;
    btn.textContent = 'Start Recording';
    progressEl.style.display = 'none';
    alert('Microphone error: ' + err.message);
    return;
  }

  clearInterval(poll);

  if (!earlyDone) {
    rxState.pcm = capturedPcm;
    btn.textContent = 'Capture complete';
    finalizeMicCapture(body);
  }
}

function finalizeMicCapture(body) {
  const canvas = body.querySelector('#rx-canvas-waveform');
  if (canvas) viz.drawWaveform(canvas, rxState.pcm, { maxSamples: 14400, color: '#3fb950' });
  body.querySelector('#rx-play-btn').disabled = false;
  body.querySelector('#rx-stop-btn').disabled = false;
  rx1El.classList.add('done');
  triggerRx2();
}

// ── Step 2: FFT Waterfall ─────────────────────────────────────────

let rx2El = null;
function buildRx2() {
  rx2El = makeCard(2, 'FFT Waterfall', '79 time steps', body => {
    body.innerHTML = `
      <p class="step-desc">The receiver searches for the Costas sync pattern to find where the frame starts. The waterfall shows all 79 symbol slots as a heat map of frequency vs time; white brackets mark the three Costas sync regions. <em>Why correlation search?</em> Correlation multiplies the received signal by a known template and sums - noise averages toward zero while the matching pattern produces a large peak, making detection reliable even at low SNR. <a href="https://en.wikipedia.org/wiki/Costas_array" target="_blank" rel="noopener noreferrer">Costas arrays</a>.</p>
      <div id="rx2-sync-info" class="mb-8" style="font:11px monospace;color:#8b949e"></div>
      <div class="canvas-wrap">
        <figure>
          <canvas id="rx-canvas-waterfall" width="860" height="160" aria-label="FFT waterfall 79 time steps"></canvas>
          <figcaption>Time → (79 symbol periods), Frequency (1400–1600 Hz)</figcaption>
        </figure>
      </div>
    `;
  });
  return rx2El;
}

// Scan for the FT8 frame start by correlating the 3×7 Costas symbols
// against the received PCM. Returns sample offset of best frame start.
// Step = 240 samples (20 ms) gives ~1/8-symbol timing resolution.
function findFrameStart(pcm) {
  const SYNC = [3, 1, 4, 0, 6, 5, 2];
  const BASES = [0, 36, 72];
  const N = 1920, FS = 12000, DF = 6.25, FC = 1500;
  const FRAME = N * 79;
  const scanMax = pcm.length - FRAME;
  if (scanMax <= 0) return 0;

  let bestScore = -Infinity, bestOffset = 0;
  for (let t0 = 0; t0 <= scanMax; t0 += 240) {
    let score = 0;
    for (const base of BASES) {
      for (let k = 0; k < 7; k++) {
        const symStart = t0 + (base + k) * N;
        const freq = FC + SYNC[k] * DF;
        let re = 0, im = 0;
        for (let n = 0; n < N; n++) {
          const angle = 2 * Math.PI * freq * n / FS;
          re += pcm[symStart + n] * Math.cos(angle);
          im += pcm[symStart + n] * Math.sin(angle);
        }
        score += Math.sqrt(re * re + im * im);
      }
    }
    if (score > bestScore) { bestScore = score; bestOffset = t0; }
  }
  return bestOffset;
}

async function triggerRx2() {
  if (!rxState.pcm) return;
  const canvas = document.getElementById('rx-canvas-waterfall');
  if (!canvas) return;

  const FRAME_LEN = 151680;
  const syncInfoEl = document.getElementById('rx2-sync-info');

  // If we captured more than one frame (mic mode), find the frame start.
  if (rxState.pcm.length > FRAME_LEN) {
    if (syncInfoEl) syncInfoEl.textContent = 'Searching for Costas sync…';
    await new Promise(r => setTimeout(r, 16)); // yield so browser can repaint
    const t0 = findFrameStart(rxState.pcm);
    rxState.pcm = rxState.pcm.slice(t0, t0 + FRAME_LEN);
    if (syncInfoEl) {
      syncInfoEl.textContent =
        `Frame sync: t₀ = ${t0} samples (${(t0 / 12000).toFixed(2)} s into capture)`;
    }
  } else {
    if (syncInfoEl) syncInfoEl.textContent = '';
  }

  const ctx2d = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx2d.clearRect(0, 0, W, H);
  ctx2d.fillStyle = '#0d1117';
  ctx2d.fillRect(0, 0, W, H);

  // N=1920 gives bin spacing = 12000/1920 = 6.25 Hz = exactly one FT8 tone spacing
  const N = 1920;
  const hopSize = 1920;
  const sampleRate = 12000;
  const fMin = 1400, fMax = 1600;
  const nyquist = sampleRate / 2;
  const kMin = Math.floor(fMin / nyquist * (N / 2));
  const kMax = Math.ceil(fMax / nyquist * (N / 2));
  const nBins = kMax - kMin;

  const nSteps = Math.floor(rxState.pcm.length / hopSize);
  const rowH = H / nSteps;
  const colW = W / nBins;

  for (let t = 0; t < nSteps; t++) {
    const offset = t * hopSize;
    const mags = selectiveDft(rxState.pcm, offset, N, kMin, kMax);
    let maxM = 0;
    for (let b = 0; b < nBins; b++) if (mags[b] > maxM) maxM = mags[b];
    if (maxM === 0) maxM = 1;

    for (let b = 0; b < nBins; b++) {
      const val = mags[b] / maxM;
      const [r, g, bl] = heatColor(val);
      ctx2d.fillStyle = `rgb(${r},${g},${bl})`;
      ctx2d.fillRect(b * colW, t * rowH, colW + 1, rowH + 1);
    }
  }

  // Mark Costas regions
  ctx2d.strokeStyle = '#ffffff';
  ctx2d.lineWidth = 1.5;
  ctx2d.setLineDash([4, 3]);
  for (const seg of [[0, 6], [36, 42], [72, 78]]) {
    const y1 = seg[0] * rowH;
    const y2 = (seg[1] + 1) * rowH;
    ctx2d.strokeRect(0, y1, W, y2 - y1);
  }
  ctx2d.setLineDash([]);

  rx2El.classList.add('done');
  triggerRx3();
}

// Compute DFT magnitudes for bins [kMin, kMax) starting at samples[offset].
// Returns a Float32Array of length (kMax - kMin) indexed from 0.
function selectiveDft(samples, offset, N, kMin, kMax) {
  const len = Math.min(N, samples.length - offset);
  const out = new Float32Array(kMax - kMin);
  for (let ki = 0; ki < kMax - kMin; ki++) {
    const k = kMin + ki;
    let re = 0, im = 0;
    for (let n = 0; n < len; n++) {
      const angle = -2 * Math.PI * k * n / N;
      re += samples[offset + n] * Math.cos(angle);
      im += samples[offset + n] * Math.sin(angle);
    }
    out[ki] = Math.sqrt(re * re + im * im) / len;
  }
  return out;
}

function heatColor(t) {
  const r = Math.floor(Math.min(255, t * 2 * 255));
  const g = Math.floor(Math.min(255, Math.max(0, (t - 0.5) * 2 * 255)));
  const b = Math.floor(Math.max(0, (0.5 - t) * 2 * 255));
  return [r, g, b];
}

// ── Step 3: Soft LLRs ─────────────────────────────────────────────

let rx3El = null;
function buildRx3() {
  rx3El = makeCard(3, 'Compute Soft LLRs', '174 f32 values', body => {
    body.innerHTML = `
      <p class="step-desc">For each of the 58 data slots, we measure how strongly each of the 8 tones is present. The result is a log-likelihood ratio (LLR) for each bit - blue means "probably 1", red means "probably 0". <em>Why soft decisions?</em> Passing a confidence value rather than a hard 0/1 decision preserves uncertainty information. The LDPC decoder uses this to focus its error-correction effort on the least-reliable bits. <a href="https://en.wikipedia.org/wiki/Soft-decision_decoder" target="_blank" rel="noopener noreferrer">Wikipedia: soft-decision decoding</a>.</p>
      <div class="canvas-wrap">
        <figure>
          <canvas id="rx-canvas-llr" width="860" height="40" aria-label="LLR bar chart, blue=positive, red=negative"></canvas>
          <figcaption>Blue = positive LLR (bit likely 1), red = negative (bit likely 0). Amber line at bit 91 marks parity.</figcaption>
        </figure>
      </div>
    `;
  });
  return rx3El;
}

function computeLLRsForFrame(pcmFrame) {
  const sampleRate = 12000, samplesPerSym = 1920, DF = 6.25, fCarrier = 1500.0;
  const softBits = new Float32Array(174);
  const dataSym = [];
  for (let i = 0; i < 79; i++) {
    if (i <= 6 || (i >= 36 && i <= 42) || i >= 72) continue;
    dataSym.push(i);
  }
  for (let si = 0; si < dataSym.length && si < 58; si++) {
    const symIdx = dataSym[si];
    const start = symIdx * samplesPerSym;
    const seg = pcmFrame.slice(start, start + samplesPerSym);
    const corr = new Float32Array(8);
    for (let tone = 0; tone < 8; tone++) {
      const freq = fCarrier + tone * DF;
      let re = 0, im = 0;
      for (let n = 0; n < seg.length; n++) {
        const angle = 2 * Math.PI * freq * n / sampleRate;
        re += seg[n] * Math.cos(angle);
        im += seg[n] * Math.sin(angle);
      }
      corr[tone] = Math.sqrt(re * re + im * im);
    }
    const GRAY_TONE = [0, 1, 3, 2, 5, 6, 4, 7];
    for (let bit = 0; bit < 3; bit++) {
      let sum0 = 0, sum1 = 0;
      for (let b = 0; b < 8; b++) {
        const tone = GRAY_TONE[b];
        const bitVal = (b >> (2 - bit)) & 1;
        if (bitVal === 1) sum1 += corr[tone];
        else sum0 += corr[tone];
      }
      softBits[si * 3 + bit] = sum1 > 1e-10 ? Math.log(sum1 / Math.max(sum0, 1e-10)) : 0;
    }
  }
  return softBits;
}

function triggerRx3() {
  if (!rxState.pcm) return;
  rxState.llr = computeLLRsForFrame(rxState.pcm);
  const canvas = document.getElementById('rx-canvas-llr');
  if (canvas) viz.drawLLRBar(canvas, rxState.llr);
  rx3El.classList.add('done');
  triggerRx4();
}

// ── Step 4: BP LDPC Decode ────────────────────────────────────────

let rx4El = null;
function buildRx4() {
  rx4El = makeCard(4, 'BP LDPC Decode', '174 bits', body => {
    body.innerHTML = `
      <p class="step-desc">The LDPC decoder runs 50 rounds of belief propagation over the parity equations, then a CRC check confirms success. <em>Why belief propagation?</em> The algorithm passes probability "messages" between bit nodes and parity-check nodes on a Tanner graph. Each round sharpens the estimates; bits strongly confirmed by multiple parity checks pull uncertain neighbours toward the correct value. This iterative process achieves near-Shannon-limit performance. <a href="https://en.wikipedia.org/wiki/Belief_propagation" target="_blank" rel="noopener noreferrer">Wikipedia: belief propagation</a>.</p>
      <div id="rx-crc-result" class="my-8"></div>
      <div class="canvas-wrap">
        <figure>
          <canvas id="rx-canvas-decoded" width="860" height="28" aria-label="LDPC decoded 174 bits"></canvas>
          <figcaption>Decoded 174-bit codeword</figcaption>
        </figure>
      </div>
    `;
  });
  return rx4El;
}

function ldpcCheckQuiet(llr) {
  const llrPtr = wasmAlloc(174 * 4);
  const llrBuf = new Float32Array(174);
  llrBuf.set(llr);
  new Uint8Array(wasm.memory.buffer, llrPtr, 174 * 4).set(new Uint8Array(llrBuf.buffer));
  const out174 = wasmAlloc(174);
  const ok = wasm.ldpc_decode(llrPtr, 174, out174, 50);
  wasm.free(llrPtr, 174 * 4);
  const bits174 = wasmReadU8(out174, 174);
  wasm.free(out174, 174);
  return { bits174, ok: !!ok };
}

function triggerRx4() {
  if (!rxState.llr) return;
  const { bits174, ok } = ldpcCheckQuiet(rxState.llr);
  rxState.bits174 = bits174;
  const crcEl = document.getElementById('rx-crc-result');
  if (crcEl) {
    crcEl.innerHTML = ok
      ? '<span class="badge badge-green">✓ CRC PASS</span>'
      : '<span class="badge badge-amber">⚠ CRC uncertain - noise too high?</span>';
  }
  const canvas = document.getElementById('rx-canvas-decoded');
  if (canvas) {
    viz.drawBitField(canvas, rxState.bits174, [
      { label: 'systematic', start: 0, end: 90, color: '#8b949e' },
      { label: 'parity', start: 91, end: 173, color: '#58a6ff' },
    ]);
  }
  rx4El.classList.add('done');
  triggerRx5();
}

// ── Step 5: Strip CRC ─────────────────────────────────────────────

let rx5El = null;
function buildRx5() {
  rx5El = makeCard(5, 'Strip CRC → 77 bits', '77 bits', body => {
    body.innerHTML = `
      <p class="step-desc">The 14 CRC bits are stripped, leaving the 77 message bits. <em>Why keep CRC to this stage?</em> The CRC travels through LDPC encoding as payload bits, so the LDPC corrector can actually repair a corrupt CRC. Only after error correction is the CRC recomputed and compared - giving one final layer of validation before the message is accepted.</p>
      <div class="canvas-wrap">
        <figure>
          <canvas id="rx-canvas-77" width="860" height="28" aria-label="77 message bits after CRC strip"></canvas>
          <figcaption>77 message bits (CRC bits 77–90 removed)</figcaption>
        </figure>
      </div>
    `;
  });
  return rx5El;
}

function triggerRx5() {
  if (!rxState.bits174) return;

  const in91 = wasmAlloc(91);
  const out77 = wasmAlloc(77);
  for (let i = 0; i < 91; i++) {
    new Uint8Array(wasm.memory.buffer)[in91 + i] = rxState.bits174[i];
  }
  wasm.strip_crc(in91, out77);
  wasm.free(in91, 91);
  rxState.bits77 = wasmReadU8(out77, 77);
  wasm.free(out77, 77);

  const canvas = document.getElementById('rx-canvas-77');
  if (canvas) {
    viz.drawBitField(canvas, rxState.bits77, [
      { label: 'message', start: 0, end: 76, color: '#58a6ff' },
    ]);
  }

  rx5El.classList.add('done');
  if (rx6El) rx6El.classList.add('active');
  triggerRx6();
}

// ── Step 6: Decoded Message ───────────────────────────────────────

let rx6El = null;
function buildRx6() {
  rx6El = makeCard(6, 'Decoded Message', 'text', body => {
    body.innerHTML = `
      <p class="step-desc">The 77 bits are unpacked back into text using the inverse of the encoding in TX step 2. <em>End-to-end:</em> from audio to decoded text, FT8 uses just 151,680 audio samples - 12.64 seconds - to carry a short message reliably across thousands of miles at power levels a smartphone battery could sustain. <a href="https://physics.princeton.edu/pulsar/k1jt/FT4_FT8_QEX.pdf" target="_blank" rel="noopener noreferrer">Taylor &amp; Franke, QEX 2020</a>.</p>
      <div class="terminal-box" id="rx-output" aria-live="polite">
        Waiting for decode…
      </div>
    `;
  });
  return rx6El;
}

function triggerRx6() {
  if (!rxState.bits77) return;

  try {
    const in77 = wasmAlloc(77);
    const outMsg = wasmAlloc(64);
    for (let i = 0; i < 77; i++) {
      new Uint8Array(wasm.memory.buffer)[in77 + i] = rxState.bits77[i];
    }
    const len = wasm.unpack77(in77, outMsg);
    wasm.free(in77, 77);

    let msg = '';
    if (len > 0) {
      msg = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, outMsg, len));
    }
    wasm.free(outMsg, 64);

    const out = document.getElementById('rx-output');
    if (out) {
      const W = 29;
      const bar = '─'.repeat(W + 2);
      out.innerHTML = msg
        ? `┌${bar}┐<br/>│ ${msg.padEnd(W)} │<br/>└${bar}┘`
        : `┌${bar}┐<br/>│ ${'(decode failed)'.padEnd(W)} │<br/>└${bar}┘`;
    }
  } finally {
    if (rx6El) rx6El.classList.add('done');
  }
}
