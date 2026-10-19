// SPDX-License-Identifier: MIT
// Web Audio API helpers. Single shared AudioContext per page.

let ctx = null;
let currentSource = null;

export async function getAudioContext() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

// Play f32 PCM at given sample rate. Returns Promise resolving when done.
export async function playPCM(f32Array, sampleRate = 12000) {
  const ac = await getAudioContext();
  if (currentSource) {
    currentSource.stop();
    currentSource = null;
  }

  const buffer = ac.createBuffer(1, f32Array.length, sampleRate);
  buffer.copyToChannel(f32Array, 0);

  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.connect(ac.destination);

  return new Promise(resolve => {
    source.onended = resolve;
    source.start();
    currentSource = source;
  });
}

export function stopPlayback() {
  if (currentSource) {
    currentSource.stop();
    currentSource = null;
  }
}

// Attach a real-time AnalyserNode spectrum to a canvas during playback.
// Returns { cleanup, ended } where ended is a Promise that resolves when
// playback finishes. Uses a single BufferSource for both audio and spectrum.
export function attachSpectrum(canvas, f32Array, sampleRate = 12000) {
  let rafId = null;
  let stopped = false;
  let resolveEnded;
  const ended = new Promise(r => { resolveEnded = r; });

  (async () => {
    const ac = await getAudioContext();
    if (currentSource) { currentSource.stop(); currentSource = null; }

    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    const freqData = new Float32Array(analyser.frequencyBinCount);

    const buffer = ac.createBuffer(1, f32Array.length, sampleRate);
    buffer.copyToChannel(f32Array, 0);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(analyser);
    analyser.connect(ac.destination);
    src.start();
    currentSource = src;

    const draw = () => {
      if (stopped) return;
      analyser.getFloatFrequencyData(freqData);
      drawSpectrumData(canvas, freqData, ac.sampleRate, [1400, 1600]);
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    src.onended = () => { cleanup(); resolveEnded(); };
  })();

  function cleanup() {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
  }

  return { cleanup, ended };
}

// Compute FFT magnitude spectrum from f32 array. Returns Float32Array.
export function computeSpectrum(f32Array, fftSize = 2048) {
  // Simplified: return magnitudes computed via DFT for display
  const N = Math.min(fftSize, f32Array.length);
  const out = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const angle = -2 * Math.PI * k * n / N;
      re += f32Array[n] * Math.cos(angle);
      im += f32Array[n] * Math.sin(angle);
    }
    out[k] = Math.sqrt(re * re + im * im) / N;
  }
  return out;
}

// Add AWGN noise to f32 array at given SNR in dB (modifies in place).
export function addAWGN(f32Array, snrDb) {
  let power = 0;
  for (const s of f32Array) power += s * s;
  power /= f32Array.length;

  const snrLinear = Math.pow(10, snrDb / 10);
  const noisePower = power / snrLinear;
  const noiseStd = Math.sqrt(noisePower);

  for (let i = 0; i < f32Array.length; i++) {
    // Box-Muller transform for Gaussian noise
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    f32Array[i] += gauss * noiseStd;
  }
}

// Capture from microphone at 12 000 Hz for durationSamples samples.
// Disables echo cancellation / noise suppression / AGC for clean FT8 capture.
// onProgress(recorded, total) is called after each buffer chunk.
// stopRef is optional { stop: false }; set stopRef.stop = true to abort early.
// Returns Promise<Float32Array>.
export async function captureMic(durationSamples, onProgress, stopRef) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });

  const recCtx = new AudioContext({ sampleRate: 12000 });
  const source = recCtx.createMediaStreamSource(stream);
  const processor = recCtx.createScriptProcessor(1024, 1, 1);

  // Mute the loopback so mic audio doesn't feed back through speakers.
  const silencer = recCtx.createGain();
  silencer.gain.value = 0;
  source.connect(processor);
  processor.connect(silencer);
  silencer.connect(recCtx.destination);

  const captured = new Float32Array(durationSamples);
  let pos = 0;

  if (stopRef) {
    stopRef.buffer = captured;
    stopRef.pos = 0;
  }

  return new Promise((resolve) => {
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const n = Math.min(input.length, durationSamples - pos);
      captured.set(input.subarray(0, n), pos);
      pos += n;
      if (stopRef) stopRef.pos = pos;
      if (onProgress) onProgress(pos, durationSamples);
      if (pos >= durationSamples || (stopRef && stopRef.stop)) {
        processor.disconnect();
        source.disconnect();
        for (const track of stream.getTracks()) track.stop();
        recCtx.close();
        resolve(captured.slice(0, pos));
      }
    };
  });
}

function drawSpectrumData(canvas, freqData, sampleRate, xRange) {
  const ctx2d = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx2d.clearRect(0, 0, W, H);
  ctx2d.fillStyle = '#0d1117';
  ctx2d.fillRect(0, 0, W, H);

  const nyquist = sampleRate / 2;
  const [fMin, fMax] = xRange;
  const binMin = Math.floor(fMin / nyquist * freqData.length);
  const binMax = Math.ceil(fMax / nyquist * freqData.length);
  const dbMin = -120, dbMax = -20;

  ctx2d.strokeStyle = '#58a6ff';
  ctx2d.lineWidth = 1.5;
  ctx2d.beginPath();
  for (let b = binMin; b <= binMax; b++) {
    const x = (b - binMin) / (binMax - binMin) * W;
    const db = freqData[b];
    const y = H - (db - dbMin) / (dbMax - dbMin) * H;
    if (b === binMin) ctx2d.moveTo(x, y);
    else ctx2d.lineTo(x, y);
  }
  ctx2d.stroke();
}
