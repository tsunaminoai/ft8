# FT8 in Zig

An open-source, browser-based walkthrough of the FT8 digital amateur radio protocol.
Shows every stage of the encode and decode pipelines with live audio synthesis and
real-time visualization.

The FT8 implementation is written in Zig 0.17 and compiled to WebAssembly.
The frontend is vanilla HTML/CSS/JavaScript with no frameworks.

## Quick Start (Nix)

```sh
nix run github:tsunaminoai/ft8
# Opens http://127.0.0.1:8000
```

## Development

```sh
nix develop       # drop into dev shell with zig, zls, wabt
zig build test    # run unit tests
zig build wasm    # build ft8.wasm
python3 -m http.server --bind 127.0.0.1 8000   # serve web/
```

## FT8 Pipeline

```txt
Message text
  ↓ pack77 (77 bits: i3 + callsigns/grid or free text)
  ↓ CRC-14 (14-bit, poly 0x6757) → 91 bits
  ↓ LDPC(174,91) encode → 174 bits
  ↓ Gray code (3-bit groups) → 58 symbols
  ↓ Insert Costas arrays [3,1,4,0,6,5,2] → 79 symbols
  ↓ GFSK synthesis (BT=2, 6.25 Hz spacing, 12000 Hz sample rate)
  ↓ 151,680 PCM samples ≈ 12.64 seconds
```

## References

* Taylor, J. K. et al., "The FT4 and FT8 Communication Protocols,"
  _QEX_, Sept/Oct 2020. https://wsjt.sourceforge.io/FT4_FT8_QEX.pdf
* WSJT-X source: https://sourceforge.net/projects/wsjt/ (GPL-3)
  (LDPC matrix data only - no runtime dependency)

## License

MIT
