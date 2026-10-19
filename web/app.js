// SPDX-License-Identifier: MIT
// WASM loader + tab router. No eval(), no external fetches.

let wasmExports = null;
export const wasmReady = loadWasm();

async function loadWasm() {
  const result = await WebAssembly.instantiateStreaming(fetch('ft8.wasm'), {
    env: {
      memory: new WebAssembly.Memory({ initial: 64 }),
    },
  });
  wasmExports = result.instance.exports;
  return wasmExports;
}

// Tab routing via URL hash
function activateTab(hash) {
  const id = (hash || '#tx').replace('#', '');
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === id);
  });
  document.querySelectorAll('nav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + id);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  activateTab(location.hash || '#tx');
  window.addEventListener('hashchange', () => activateTab(location.hash));

  const loading = document.getElementById('loading');

  try {
    const wasm = await wasmReady;

    // Dynamically import demo controllers after WASM is ready
    const [txMod, rxMod] = await Promise.all([
      import('./tx-demo.js'),
      import('./rx-demo.js'),
    ]);
    txMod.initTx(wasm);
    rxMod.initRx(wasm);

    loading.classList.add('hidden');
    setTimeout(() => loading.remove(), 400);
  } catch (err) {
    const p = loading.querySelector('p');
    if (p) p.textContent = 'Failed to load ft8.wasm - run zig build wasm first.';
    console.error(err);
  }
});
