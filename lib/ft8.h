// SPDX-License-Identifier: MIT
// ft8.h - Public API reference for libft8.a
//
// This is a Zig static library. Zig callers: @import("ft8") via the build module.
// C callers: link against libft8.a and include this header. Functions marked
// FT8_EXPORT are exported with C ABI; allocator-based functions are Zig-only.

#ifndef FT8_H
#define FT8_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

#define FT8_BITS_MSG        77   // user message bits
#define FT8_BITS_CRC        14   // CRC-14 appended bits
#define FT8_BITS_INFO       91   // message + CRC
#define FT8_BITS_LDPC      174   // LDPC(174,91) codeword
#define FT8_SYMBOLS_DATA    58   // Gray-coded data symbols
#define FT8_SYMBOLS_FRAME   79   // full frame incl. 3x Costas
#define FT8_SAMPLE_RATE  12000   // Hz
#define FT8_SAMPLES_SYM   1920   // samples per symbol at 12 kHz
#define FT8_SAMPLES_FRAME 151680 // 79 * 1920
#define FT8_BAUD            6.25 // symbols/second
#define FT8_TONE_SPACING    6.25 // Hz between adjacent tones (= 1/T)
#define FT8_CARRIER_DEFAULT 1500 // Hz, conventional dial offset

// ---------------------------------------------------------------------------
// CRC-14  (poly 0x6757, covers 77 message bits)
// ---------------------------------------------------------------------------

// Returns the 14-bit CRC of `len` bits packed one-per-byte (each byte is 0 or 1).
// FT8_EXPORT
uint16_t ft8_crc14(const uint8_t *bits, size_t len);

// ---------------------------------------------------------------------------
// Gray code  (3-bit, maps bit triads to 8-FSK tone indices)
// ---------------------------------------------------------------------------

// Convert a 3-bit Gray code value (0-7) to an 8-FSK tone index (0-7).
// FT8_EXPORT
uint8_t ft8_bits_to_tone(uint8_t bits);

// Convert an 8-FSK tone index (0-7) back to a 3-bit Gray code value (0-7).
// FT8_EXPORT
uint8_t ft8_tone_to_bits(uint8_t tone);

// ---------------------------------------------------------------------------
// LDPC(174,91)
// ---------------------------------------------------------------------------

// Encode 91 information bits into a 174-bit LDPC codeword.
// `in`  - 91 bytes, each 0 or 1
// `out` - 174 bytes, each 0 or 1  (first 91 = systematic, last 83 = parity)
// FT8_EXPORT
void ft8_ldpc_encode(const uint8_t *in, uint8_t *out);

// Belief-propagation LDPC decoder.
// `llr`        - 174 log-likelihood ratios (positive = likely 1)
// `out`        - 174 bytes output (each 0 or 1)
// `iterations` - BP iteration limit (50 is typical)
// Returns true if the decoded codeword satisfies all parity checks.
// FT8_EXPORT
bool ft8_ldpc_decode(const float *llr, uint8_t *out, uint32_t iterations);

// ---------------------------------------------------------------------------
// Costas sync array  [3,1,4,0,6,5,2]
// ---------------------------------------------------------------------------

// Insert three Costas arrays into a 58-symbol data array to produce the
// 79-symbol transmit frame.
// `data`  - 58 tone values (0-7)
// `frame` - 79 tone values output
// FT8_EXPORT
void ft8_costas_build_frame(const uint8_t *data, uint8_t *frame);

// ---------------------------------------------------------------------------
// Notes on allocator-based functions (Zig-only)
// ---------------------------------------------------------------------------
//
// The following pipeline functions require a Zig std.mem.Allocator and are
// not directly callable from C without a wrapper. Use the Zig @import("ft8")
// module for these:
//
//   ft8.encodeFreeTextToAudio(text, f_carrier, sample_rate, allocator) ![]f32
//   ft8.encodeStandardToAudio(call1, call2, grid, f_carrier, sample_rate, allocator) ![]f32
//   ft8.gfsk.synthesize(symbols[79], f_carrier, sample_rate, allocator) ![]f32
//   ft8.message.encodeFreeText(text, out_bits77[77]) !void
//   ft8.message.encodeStandard(call1, call2, grid, out_bits77[77]) !void
//   ft8.message.decode(bits[77], buf) ![]u8

#ifdef __cplusplus
}
#endif

#endif /* FT8_H */
