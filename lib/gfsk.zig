// SPDX-License-Identifier: MIT
// GFSK waveform synthesis for FT8.
// Produces 151,680 f32 PCM samples at 12000 Hz for a 79-symbol frame.

const std = @import("std");

const SAMPLES_PER_SYM: usize = 1920; // 12000 Hz / 6.25 baud
const SYMBOL_DURATION: f32 = 1.0 / 6.25; // 0.16 s
const BT: f32 = 2.0;
const H: f32 = 1.0; // modulation index
const DF: f32 = 6.25; // tone spacing Hz
const TAPER_LEN: usize = 240; // raised-cosine taper samples

// k = sqrt(2π / ln2)
const K: f32 = 5.336_446_3;

// Abramowitz & Stegun approximation for erf(x), max error 1.5e-7.
fn erfApprox(x: f32) f32 {
    const t = 1.0 / (1.0 + 0.3275911 * @abs(x));
    const poly = t * (0.254829592 +
        t * (-0.284496736 +
        t * (1.421413741 +
        t * (-1.453152027 +
        t * 1.061405429))));
    const e = 1.0 - poly * @exp(-x * x);
    return if (x >= 0.0) e else -e;
}

// Precomputed Gaussian pulse kernel at BT=2, N=1920.
// p[n] = (1/(2T)) * [erf(k*BT/2*(n/N + 0.5)) - erf(k*BT/2*(n/N - 0.5))]
// where n is centered: n_c = n - N/2.
// We store one symbol worth (1920 samples) and convolve.
const KERNEL_LEN: usize = SAMPLES_PER_SYM;
var kernel_cache: ?[KERNEL_LEN]f32 = null;

fn getKernel() [KERNEL_LEN]f32 {
    if (kernel_cache) |k| return k;
    var k: [KERNEL_LEN]f32 = undefined;
    const N: f32 = @floatFromInt(SAMPLES_PER_SYM);
    const factor = K * BT / 2.0;
    var sum: f32 = 0.0;
    for (0..KERNEL_LEN) |i| {
        const t = (@as(f32, @floatFromInt(i)) - N / 2.0) / N;
        const v = factor * (t + 0.5);
        const w = factor * (t - 0.5);
        // erf approximation via std
        k[i] = (erfApprox(v) - erfApprox(w)) * (1.0 / (2.0 * SYMBOL_DURATION));
        sum += k[i];
    }
    // Normalize so sum = SAMPLES_PER_SYM: over one symbol period the integrated
    // frequency deviation equals s * DF (modulation index h = 1 requires
    // DF * H * sum(kernel) / fs = 1 → sum = fs/DF = 1920).
    const target: f32 = @as(f32, @floatFromInt(SAMPLES_PER_SYM));
    if (sum > 0.0) {
        for (&k) |*v| v.* *= target / sum;
    }
    kernel_cache = k;
    return k;
}

// Synthesize a 79-symbol FT8 frame into PCM f32 samples at 12000 Hz.
// Returns a slice of 151,680 samples, allocated from `allocator`.
// Amplitude tapered with raised-cosine over first and last 240 samples.
pub fn synthesize(
    symbols: []const u3,
    f_carrier: f32,
    sample_rate: u32,
    allocator: std.mem.Allocator,
) ![]f32 {
    const n_syms = symbols.len;
    const total = n_syms * SAMPLES_PER_SYM;
    const pcm = try allocator.alloc(f32, total);
    @memset(pcm, 0.0);

    const kernel = getKernel();
    const fs: f32 = @floatFromInt(sample_rate);
    const pi2 = 2.0 * std.math.pi;

    // Compute instantaneous phase via Gaussian frequency pulse convolution.
    // freq[n] = f_carrier + DF * h * sum_m sym[m] * kernel[n - m*N]
    // phase[n] = integral of 2*pi*freq[n] / fs

    var phase: f32 = 0.0;

    for (0..total) |n| {
        // Accumulate frequency contribution from each symbol
        var freq: f32 = f_carrier;
        for (0..n_syms) |m| {
            const center: i64 = @as(i64, @intCast(m)) * SAMPLES_PER_SYM;
            const offset: i64 = @as(i64, @intCast(n)) - center;
            if (offset >= 0 and offset < KERNEL_LEN) {
                freq += DF * H * @as(f32, @floatFromInt(symbols[m])) * kernel[@intCast(offset)];
            }
        }

        pcm[n] = @cos(phase);
        phase += pi2 * freq / fs;
        // Keep phase bounded
        if (phase > pi2) phase -= pi2;
    }

    // Raised-cosine amplitude taper: first and last TAPER_LEN samples
    for (0..TAPER_LEN) |i| {
        const t: f32 = @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(TAPER_LEN));
        const env = 0.5 * (1.0 - @cos(std.math.pi * t));
        pcm[i] *= env;
        pcm[total - 1 - i] *= env;
    }

    return pcm;
}
