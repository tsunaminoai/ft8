// SPDX-License-Identifier: MIT
// TX pipeline step-card controller.

import * as viz from './visualize.js';
import * as audio from './audio.js';

const CALLSIGN_RE = /^[A-Z0-9]{1,2}[0-9][A-Z]{1,3}$/;
const GRID_RE = /^[A-R]{2}[0-9]{2}$/;
const FREETEXT_ALLOWED = /^[0-9A-Z +\-./?]+$/;

const COLOR_CLASS = {
  '#58a6ff': 'swatch-blue',
  '#3fb950': 'swatch-green',
  '#d29922': 'swatch-amber',
  '#bc8cff': 'swatch-purple',
  '#30363d': 'swatch-border',
  '#8b949e': 'swatch-muted',
  '#f85149': 'swatch-red',
  '#79c0ff': 'swatch-ltblue',
  '#39d353': 'swatch-ltgreen',
};

let wasm = null;

export function initTx(wasmExports) {
  wasm = wasmExports;
  buildSteps();
}

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

function wasmReadF32(ptr, len) {
  const bytes = new Uint8Array(wasm.memory.buffer, ptr, len * 4).slice();
  return new Float32Array(bytes.buffer, 0, len);
}

// ── State ────────────────────────────────────────────────────────

const state = {
  bits77: null,
  bits91: null,
  bits174: null,
  symbols58: null,
  symbols79: null,
  pcm: null,
  isFreetext: false,
};

// ── Step builders ────────────────────────────────────────────────

function buildSteps() {
  const container = document.getElementById('tx-steps');
  if (!container) return;

  container.innerHTML = '';

  const resetRow = document.createElement('div');
  resetRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:10px';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'secondary';
  resetBtn.textContent = '↺ Start Over';
  resetBtn.addEventListener('click', () => {
    Object.assign(state, { bits77:null, bits91:null, bits174:null, symbols58:null, symbols79:null, pcm:null, isFreetext:false });
    buildSteps();
  });
  resetRow.appendChild(resetBtn);
  container.appendChild(resetRow);

  const steps = [
    buildStep1(),
    buildStep2(),
    buildStep3(),
    buildStep4(),
    buildStep5(),
    buildStep6(),
    buildStep7(),
    buildStep8(),
  ];
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

// ── Step 1: Message Input ────────────────────────────────────────

function buildStep1() {
  return makeCard(1, 'Message Input', '77 bits', body => {
    body.innerHTML = `
      <p class="step-desc">Type the message to transmit. A standard FT8 message contains two callsigns and a grid square (e.g. W9XYZ → K1JT, grid EN50). You can also send short free text up to 13 characters. <em>Why structured?</em> Fixed-length, predictable fields let the error-correcting decoder know exactly what to expect - any unexpected pattern signals an error. <a href="https://physics.princeton.edu/pulsar/k1jt/FT4_FT8_QEX.pdf" target="_blank" rel="noopener noreferrer">Taylor &amp; Franke, QEX 2020</a>.</p>
      <div class="mb-12">
        <label>Mode</label>
        <select id="tx-mode">
          <option value="standard">Standard (Callsign + Grid)</option>
          <option value="freetext" selected>Free Text (max 13 chars)</option>
        </select>
      </div>
      <div id="tx-standard-inputs" class="hidden">
        <div class="input-group">
          <div>
            <label for="tx-call1">Your callsign</label>
            <input type="text" id="tx-call1" value="W9XYZ" maxlength="6"
                   aria-label="Your callsign" placeholder="W9XYZ">
          </div>
          <div>
            <label for="tx-call2">Other callsign</label>
            <input type="text" id="tx-call2" value="K1JT" maxlength="6"
                   aria-label="Other callsign" placeholder="K1JT">
          </div>
          <div>
            <label for="tx-grid">Grid</label>
            <input type="text" id="tx-grid" value="EN50" maxlength="4"
                   aria-label="Grid locator" placeholder="EN50">
          </div>
        </div>
        <div class="input-error" id="tx-std-error"></div>
      </div>
      <div id="tx-freetext-inputs">
        <label for="tx-freetext">Free text (A-Z 0-9 +-./?)</label>
        <textarea id="tx-freetext" maxlength="13" rows="2"
                  aria-label="Free text message">CQ W9XYZ EN50</textarea>
        <div class="input-error" id="tx-ft-error"></div>
      </div>
      <div class="mt-12">
        <button id="tx-step1-go">Pack 77 bits →</button>
      </div>
    `;

    body.querySelector('#tx-mode').addEventListener('change', e => {
      const isFt = e.target.value === 'freetext';
      body.querySelector('#tx-standard-inputs').classList.toggle('hidden', isFt);
      body.querySelector('#tx-freetext-inputs').classList.toggle('hidden', !isFt);
    });

    body.querySelector('#tx-step1-go').addEventListener('click', () => {
      runStep1(body);
    });
  });
}

function runStep1(body) {
  const mode = body.querySelector('#tx-mode').value;
  state.isFreetext = mode === 'freetext';

  const errStd = body.querySelector('#tx-std-error');
  const errFt = body.querySelector('#tx-ft-error');
  errStd.classList.remove('visible');
  errFt.classList.remove('visible');

  const out77 = wasmAlloc(77);

  if (state.isFreetext) {
    const text = body.querySelector('#tx-freetext').value.toUpperCase().slice(0, 13);
    if (!FREETEXT_ALLOWED.test(text)) {
      errFt.textContent = 'Only A-Z 0-9 + - . / ? space allowed';
      errFt.classList.add('visible');
      return;
    }
    const { ptr, len } = wasmWriteStr(text);
    const ok = wasm.pack77_freetext(ptr, len, out77);
    wasm.free(ptr, len);
    if (!ok) { errFt.textContent = 'Encoding failed'; errFt.classList.add('visible'); return; }
  } else {
    const call1 = body.querySelector('#tx-call1').value.toUpperCase().trim();
    const call2 = body.querySelector('#tx-call2').value.toUpperCase().trim();
    const grid = body.querySelector('#tx-grid').value.toUpperCase().trim();

    if (!CALLSIGN_RE.test(call1)) {
      errStd.textContent = 'Invalid callsign format: ' + call1;
      errStd.classList.add('visible');
      body.querySelector('#tx-call1').setAttribute('aria-invalid', 'true');
      return;
    }
    body.querySelector('#tx-call1').removeAttribute('aria-invalid');

    if (!GRID_RE.test(grid)) {
      errStd.textContent = 'Grid must be e.g. EN50 (2 letters A-R + 2 digits)';
      errStd.classList.add('visible');
      body.querySelector('#tx-grid').setAttribute('aria-invalid', 'true');
      return;
    }
    body.querySelector('#tx-grid').removeAttribute('aria-invalid');

    const c1 = wasmWriteStr(call1);
    const c2 = wasmWriteStr(call2);
    const g = wasmWriteStr(grid);
    const ok = wasm.pack77_standard(c1.ptr, c1.len, c2.ptr, c2.len, g.ptr, g.len, out77);
    wasm.free(c1.ptr, c1.len);
    wasm.free(c2.ptr, c2.len);
    wasm.free(g.ptr, g.len);
    if (!ok) { errStd.textContent = 'Encoding failed'; errStd.classList.add('visible'); return; }
  }

  state.bits77 = wasmReadU8(out77, 77);
  wasm.free(out77, 77);

  // Advance to step 2
  triggerStep2();
}

// ── Step 2: Pack 77 bits ─────────────────────────────────────────

let step2El = null;
function buildStep2() {
  step2El = makeCard(2, 'Pack 77 bits', '77 bits', body => {
    body.innerHTML = `
      <p class="step-desc">Message fields packed into 77 bits using base-42 or callsign encoding. <em>Why 77?</em> Callsigns are encoded in base-37 (letters, digits, space) fitting in 28 bits each; the grid locator in 15 bits. Packing tightly maximises the fraction of bits used for error correction in the next step. <a href="https://physics.princeton.edu/pulsar/k1jt/FT4_FT8_QEX.pdf" target="_blank" rel="noopener noreferrer">FT8 protocol spec</a>.</p>
      <div class="canvas-wrap">
        <figure>
          <canvas id="tx-canvas-77" width="860" height="28" aria-label="77-bit field visualization"></canvas>
          <figcaption>Bit field map - color = field type</figcaption>
        </figure>
      </div>
      <div class="field-legend" id="tx-legend-77"></div>
      <div class="result-box mono result-box-sm" id="tx-bits77-hex"></div>
    `;
  });
  return step2El;
}

function triggerStep2() {
  if (!state.bits77) return;
  const canvas = document.getElementById('tx-canvas-77');
  const hex = document.getElementById('tx-bits77-hex');
  const legend = document.getElementById('tx-legend-77');
  if (!canvas) return;

  const fields = state.isFreetext ? [
    { label: 'text', start: 0, end: 70, color: '#58a6ff' },
    { label: 'i3', start: 74, end: 76, color: '#bc8cff' },
  ] : [
    { label: 'call1', start: 0, end: 27, color: '#58a6ff' },
    { label: 'r1', start: 28, end: 28, color: '#30363d' },
    { label: 'call2', start: 29, end: 56, color: '#3fb950' },
    { label: 'r1', start: 57, end: 57, color: '#30363d' },
    { label: 'R', start: 58, end: 58, color: '#30363d' },
    { label: 'grid', start: 59, end: 73, color: '#d29922' },
    { label: 'i3', start: 74, end: 76, color: '#bc8cff' },
  ];

  viz.drawBitField(canvas, state.bits77, fields);

  legend.innerHTML = '';
  for (const f of fields) {
    const wrap = document.createElement('div');
    wrap.className = 'field-swatch';
    const dot = document.createElement('div');
    dot.className = 'swatch-dot ' + (COLOR_CLASS[f.color] || '');
    const lbl = document.createElement('span');
    lbl.textContent = `${f.label} [${f.start}–${f.end}]`;
    wrap.appendChild(dot);
    wrap.appendChild(lbl);
    legend.appendChild(wrap);
  }

  const hexStr = Array.from(state.bits77).join('');
  hex.textContent = hexStr.slice(0, 77);

  step2El.classList.add('done');
  triggerStep3();
}

// ── Step 3: Append CRC ───────────────────────────────────────────

let step3El = null;
function buildStep3() {
  step3El = makeCard(3, 'Append 14-bit CRC', '91 bits', body => {
    body.innerHTML = `
      <p class="step-desc">CRC-14 (polynomial 0x6757) appended to bits 77–90. <em>Why CRC?</em> LDPC decoding might converge on a mathematically valid-but-wrong codeword. The CRC is an independent check that catches these rare false positives and prevents displaying garbage. <a href="https://en.wikipedia.org/wiki/Cyclic_redundancy_check" target="_blank" rel="noopener noreferrer">Wikipedia: CRC</a>.</p>
      <div class="canvas-wrap">
        <figure>
          <canvas id="tx-canvas-91" width="860" height="28" aria-label="91-bit field visualization"></canvas>
          <figcaption>Blue = message bits, amber = 14-bit CRC</figcaption>
        </figure>
      </div>
      <div class="result-box mono" id="tx-crc-val"></div>
    `;
  });
  return step3El;
}

function triggerStep3() {
  if (!state.bits77) return;
  const out91 = wasmAlloc(91);
  const in77 = wasmAlloc(77);
  for (let i = 0; i < 77; i++) {
    new Uint8Array(wasm.memory.buffer)[in77 + i] = state.bits77[i];
  }
  wasm.append_crc(in77, out91);
  wasm.free(in77, 77);
  state.bits91 = wasmReadU8(out91, 91);
  wasm.free(out91, 91);

  const canvas = document.getElementById('tx-canvas-91');
  if (!canvas) return;

  const fields = [
    { label: 'message', start: 0, end: 76, color: '#58a6ff' },
    { label: 'CRC-14', start: 77, end: 90, color: '#d29922' },
  ];
  viz.drawBitField(canvas, state.bits91, fields);

  let crcVal = 0;
  for (let i = 0; i < 14; i++) crcVal |= state.bits91[77 + i] << i;
  const crcEl = document.getElementById('tx-crc-val');
  if (crcEl) crcEl.textContent = `CRC-14 = 0x${crcVal.toString(16).padStart(4, '0').toUpperCase()}  (${crcVal} decimal)`;

  step3El.classList.add('done');
  triggerStep4();
}

// ── Step 4: LDPC Encode ──────────────────────────────────────────

let step4El = null;
function buildStep4() {
  step4El = makeCard(4, 'LDPC Encode → 174 bits', '174 bits', body => {
    body.innerHTML = `
      <p class="step-desc">LDPC(174,91) adds 83 parity bits, nearly doubling the data. <em>Why LDPC?</em> Low-density parity-check codes approach the Shannon limit - the theoretical maximum for a noisy channel. FT8 decodes correctly at signal levels 10 dB below what SSB voice requires. <a href="https://en.wikipedia.org/wiki/Low-density_parity-check_code" target="_blank" rel="noopener noreferrer">Wikipedia: LDPC</a>. <span id="tx-parity-note" class="text-muted"></span></p>
      <div class="canvas-wrap">
        <figure>
          <canvas id="tx-canvas-174" width="860" height="28" aria-label="174-bit LDPC codeword"></canvas>
          <figcaption>Gray = systematic (91 bits), blue = parity (83 bits)</figcaption>
        </figure>
      </div>
    `;
  });
  return step4El;
}

function triggerStep4() {
  if (!state.bits91) return;
  const out174 = wasmAlloc(174);
  const in91 = wasmAlloc(91);
  for (let i = 0; i < 91; i++) {
    new Uint8Array(wasm.memory.buffer)[in91 + i] = state.bits91[i];
  }
  wasm.ldpc_encode(in91, out174);
  wasm.free(in91, 91);
  state.bits174 = wasmReadU8(out174, 174);
  wasm.free(out174, 174);

  const canvas = document.getElementById('tx-canvas-174');
  if (!canvas) return;

  const fields = [
    { label: 'systematic', start: 0, end: 90, color: '#8b949e' },
    { label: 'parity', start: 91, end: 173, color: '#58a6ff' },
  ];
  viz.drawBitField(canvas, state.bits174, fields);
  step4El.classList.add('done');
  triggerStep5();
}

// ── Step 5: Gray Code → 58 Symbols ──────────────────────────────

let step5El = null;
function buildStep5() {
  step5El = makeCard(5, 'Gray Code → 58 Symbols', '58 symbols', body => {
    body.innerHTML = `
      <p class="step-desc">3-bit groups mapped via Gray code to 8-FSK tones (0–7). <em>Why Gray code?</em> Adjacent tone numbers differ by only one bit. When noise causes the receiver to misidentify a tone by ±1 step (the most common error), only a single bit is wrong instead of potentially all three - significantly reducing the LDPC decoder's workload. <a href="https://en.wikipedia.org/wiki/Gray_code" target="_blank" rel="noopener noreferrer">Wikipedia: Gray code</a>.</p>
      <div id="tx-gray-table-wrap">
        <table class="gray-code-table">
          <thead>
            <tr>
              <th>Sym#</th>
              <th>Bits</th>
              <th>→</th>
              <th>Tone</th>
              <th class="th-empty"></th>
            </tr>
          </thead>
          <tbody id="tx-gray-tbody"></tbody>
        </table>
        <button class="collapse-toggle" id="tx-gray-toggle">Show all 58 →</button>
      </div>
      <div class="result-box mono result-box-sm mt-8" id="tx-symbols58"></div>
    `;

    body.querySelector('#tx-gray-toggle').addEventListener('click', function() {
      fillGrayTable(true);
      this.classList.add('hidden');
    });
  });
  return step5El;
}

function triggerStep5() {
  if (!state.bits174) return;
  const out58 = wasmAlloc(58);
  const in174 = wasmAlloc(174);
  for (let i = 0; i < 174; i++) {
    new Uint8Array(wasm.memory.buffer)[in174 + i] = state.bits174[i];
  }
  wasm.gray_to_symbols(in174, out58);
  wasm.free(in174, 174);
  state.symbols58 = wasmReadU8(out58, 58);
  wasm.free(out58, 58);

  fillGrayTable(false);
  const el = document.getElementById('tx-symbols58');
  if (el) el.textContent = 'Tones: [' + Array.from(state.symbols58).join(', ') + ']';
  step5El.classList.add('done');
  triggerStep6();
}

function fillGrayTable(all) {
  if (!state.bits174 || !state.symbols58) return;
  const tbody = document.getElementById('tx-gray-tbody');
  if (!tbody) return;
  const n = all ? 58 : 8;
  tbody.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const b0 = state.bits174[3 * i];
    const b1 = state.bits174[3 * i + 1];
    const b2 = state.bits174[3 * i + 2];
    const tone = state.symbols58[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i}</td>
      <td>${b0}${b1}${b2}</td>
      <td class="text-muted">→</td>
      <td>${tone}</td>
      <td><div class="tone-swatch tone-${tone}"></div></td>
    `;
    tbody.appendChild(tr);
  }
}

// ── Step 6: Insert Costas → 79 Symbols ──────────────────────────

let step6El = null;
function buildStep6() {
  step6El = makeCard(6, 'Insert Costas Arrays → 79 Symbols', '79 symbols', body => {
    body.innerHTML = `
      <p class="step-desc">Three copies of the Costas sync array <span class="badge badge-blue">3,1,4,0,6,5,2</span> inserted at positions 0–6, 36–42, 72–78. <em>Why Costas?</em> Costas arrays have a "thumbtack" autocorrelation - a sharp peak at the correct time/frequency and near-zero everywhere else. This lets the receiver lock on to the frame even with timing uncertainty and small frequency offsets. <a href="https://en.wikipedia.org/wiki/Costas_array" target="_blank" rel="noopener noreferrer">Wikipedia: Costas array</a>.</p>
      <div class="canvas-wrap">
        <figure>
          <canvas id="tx-canvas-79" width="860" height="36" aria-label="79-symbol frame with Costas arrays"></canvas>
          <figcaption>Dashed white outline = Costas sync regions</figcaption>
        </figure>
      </div>
    `;
  });
  return step6El;
}

function triggerStep6() {
  if (!state.symbols58) return;
  const out79 = wasmAlloc(79);
  const in58 = wasmAlloc(58);
  for (let i = 0; i < 58; i++) {
    new Uint8Array(wasm.memory.buffer)[in58 + i] = state.symbols58[i];
  }
  wasm.build_frame(in58, out79);
  wasm.free(in58, 58);
  state.symbols79 = wasmReadU8(out79, 79);
  wasm.free(out79, 79);

  const canvas = document.getElementById('tx-canvas-79');
  if (canvas) viz.drawSymbolFrame(canvas, state.symbols79, { highlightCostas: true });
  step6El.classList.add('done');
  triggerStep7();
}

// ── Step 7: GFSK Waveform ────────────────────────────────────────

let step7El = null;
function buildStep7() {
  step7El = makeCard(7, 'GFSK Waveform Synthesis', '151,680 samples', body => {
    body.innerHTML = `
      <p class="step-desc">Gaussian frequency-shift keying (GFSK) at 6.25 baud, BT=2. 79 symbols × 1920 samples = 151,680 samples @ 12 kHz ≈ 12.64 s. <em>Why Gaussian filtering?</em> Plain FSK switches frequencies abruptly, spreading energy into adjacent channels. The Gaussian pulse smooths each transition, keeping FT8's occupied bandwidth under 50 Hz so many stations can share a single band segment. <a href="https://en.wikipedia.org/wiki/Gaussian_frequency-shift_keying" target="_blank" rel="noopener noreferrer">Wikipedia: GFSK</a>.</p>
      <div class="canvas-wrap">
        <figure>
          <canvas id="tx-canvas-waveform" width="860" height="120" aria-label="GFSK waveform (first 1.2 s)"></canvas>
          <figcaption>First 1.2 s of waveform</figcaption>
        </figure>
      </div>
      <div class="canvas-wrap">
        <figure>
          <canvas id="tx-canvas-spectrum" width="860" height="100" aria-label="Frequency spectrum 1450–1600 Hz"></canvas>
          <figcaption>Frequency spectrum 1450–1600 Hz</figcaption>
        </figure>
      </div>
      <p class="step-desc mt-8">
        Carrier: 1500 Hz. Tone spacing: 6.25 Hz.<br>
        f₀=1500, f₁=1506.25, f₂=1512.5, f₃=1518.75, f₄=1525, f₅=1531.25, f₆=1537.5, f₇=1543.75 Hz
      </p>
    `;
  });
  return step7El;
}

function triggerStep7() {
  if (!state.symbols79) return;
  const PCM_LEN = 151680;
  try {
    const pcmPtr = wasmAlloc(PCM_LEN * 4);
    const in79 = wasmAlloc(79);
    for (let i = 0; i < 79; i++) {
      new Uint8Array(wasm.memory.buffer)[in79 + i] = state.symbols79[i];
    }
    const n = wasm.synthesize(in79, 1500.0, pcmPtr);
    wasm.free(in79, 79);
    state.pcm = wasmReadF32(pcmPtr, n || PCM_LEN);
    wasm.free(pcmPtr, PCM_LEN * 4);
    wasm.arena_reset();

    const canvasW = document.getElementById('tx-canvas-waveform');
    const canvasSp = document.getElementById('tx-canvas-spectrum');
    if (canvasW) viz.drawWaveform(canvasW, state.pcm, { maxSamples: 14400, label: 'First 1.2s', sampleRate: 12000 });

    if (canvasSp) {
      // Selective DFT: only compute bins in the display range (fast)
      const mags = computeMagnitudesRange(state.pcm, 2048, 1450, 1600, 12000);
      viz.drawSpectrum(canvasSp, mags, 12000, { xRange: [1450, 1600], label: 'Spectrum' });
    }
  } finally {
    step7El.classList.add('done');
    if (step8El) step8El.classList.add('active');
  }
}

// Compute DFT magnitudes only for bins in [fMin, fMax] Hz - sparse output array.
// Using selective DFT (vs full N² DFT) keeps this fast enough for the UI thread.
function computeMagnitudesRange(samples, fftSize, fMin, fMax, sampleRate) {
  const N = Math.min(fftSize, samples.length);
  const nyquist = sampleRate / 2;
  const kMin = Math.floor(fMin / nyquist * (N / 2));
  const kMax = Math.ceil(fMax / nyquist * (N / 2));
  const out = new Float32Array(N / 2);
  for (let k = kMin; k <= kMax; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const angle = -2 * Math.PI * k * n / N;
      re += samples[n] * Math.cos(angle);
      im += samples[n] * Math.sin(angle);
    }
    out[k] = Math.sqrt(re * re + im * im) / N;
  }
  return out;
}

// ── Step 8: Play Audio ────────────────────────────────────────────

let step8El = null;
function buildStep8() {
  step8El = makeCard(8, 'Play Audio', '12.64 s', body => {
    body.innerHTML = `
      <p class="step-desc">Play the 12.64-second FT8 frame. <em>Real-world use:</em> This audio would be fed into the microphone input of a transceiver set to USB (upper sideband) mode. The 1400–1600 Hz audio tones become RF frequencies offset from the carrier - for example at 14.074 MHz the tones land at 14.075400–14.075600 MHz.</p>
      <div class="play-controls">
        <button id="tx-play-btn">▶ Play</button>
        <button id="tx-stop-btn" class="secondary">■ Stop</button>
        <span id="tx-time-badge" class="badge badge-blue">0.0 / 12.64 s</span>
      </div>
      <div class="progress-wrap" aria-label="Playback progress">
        <div class="progress-bar" id="tx-progress"></div>
      </div>
      <div class="canvas-wrap mt-12">
        <figure>
          <canvas id="tx-canvas-live" width="860" height="80" aria-label="Live spectrum during playback"></canvas>
          <figcaption>Live spectrum (during playback)</figcaption>
        </figure>
      </div>
    `;

    let playing = false;
    let cleanup = null;
    let startTime = null;

    const playBtn = body.querySelector('#tx-play-btn');
    const stopBtn = body.querySelector('#tx-stop-btn');
    const progress = body.querySelector('#tx-progress');
    const timeBadge = body.querySelector('#tx-time-badge');

    function updateProgress() {
      if (!startTime || !playing) return;
      const elapsed = (Date.now() - startTime) / 1000;
      const frac = Math.min(1, elapsed / 12.64);
      progress.style.width = (frac * 100) + '%';
      timeBadge.textContent = elapsed.toFixed(1) + ' / 12.64 s';
      if (frac < 1 && playing) requestAnimationFrame(updateProgress);
    }

    playBtn.addEventListener('click', async () => {
      if (!state.pcm) return;
      playBtn.disabled = true;
      playing = true;
      startTime = Date.now();

      const canvas = body.querySelector('#tx-canvas-live');
      const handle = audio.attachSpectrum(canvas, state.pcm, 12000);
      cleanup = handle.cleanup;
      requestAnimationFrame(updateProgress);

      try {
        await handle.ended;
      } finally {
        playing = false;
        playBtn.disabled = false;
        cleanup = null;
      }
    });

    stopBtn.addEventListener('click', () => {
      playing = false;
      audio.stopPlayback();
      playBtn.disabled = false;
      if (cleanup) { cleanup(); cleanup = null; }
    });
  });
  return step8El;
}
