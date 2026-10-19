// SPDX-License-Identifier: MIT
// WASM export functions for the FT8 demo frontend.
// All pointer arguments are WASM linear memory addresses.
// JS must call alloc/free to manage WASM heap; arena_reset after each cycle.

const std = @import("std");
const ft8 = @import("ft8");
const alloc_mod = @import("allocator.zig");

// ── Memory Management ────────────────────────────────────────────────────────

export fn alloc(size: usize) ?[*]u8 {
    const slice = alloc_mod.allocator.alloc(u8, size) catch return null;
    return slice.ptr;
}

export fn free(ptr: [*]u8, size: usize) void {
    alloc_mod.allocator.free(ptr[0..size]);
}

// arena_reset is exported directly from wasm/allocator.zig

// ── TX Pipeline ──────────────────────────────────────────────────────────────

export fn pack77_standard(
    call1: [*]const u8,
    call1_len: usize,
    call2: [*]const u8,
    call2_len: usize,
    grid: [*]const u8,
    grid_len: usize,
    out77: [*]u8,
) bool {
    if (call1_len > 6 or call2_len > 6 or grid_len != 4) return false;
    var bits: [77]u1 = undefined;
    ft8.message.encodeStandard(
        call1[0..call1_len],
        call2[0..call2_len],
        grid[0..grid_len],
        &bits,
    ) catch return false;
    for (bits, 0..) |b, i| out77[i] = b;
    return true;
}

export fn pack77_freetext(
    text: [*]const u8,
    text_len: usize,
    out77: [*]u8,
) bool {
    if (text_len > 13) return false;
    var bits: [77]u1 = undefined;
    ft8.message.encodeFreeText(text[0..text_len], &bits) catch return false;
    for (bits, 0..) |b, i| out77[i] = b;
    return true;
}

export fn append_crc(in77: [*]const u8, out91: [*]u8) void {
    var bits77: [77]u1 = undefined;
    for (0..77) |i| bits77[i] = @truncate(in77[i]);
    for (0..77) |i| out91[i] = in77[i];
    const crc_val = ft8.crc.crc14(&bits77);
    for (0..14) |i| {
        out91[77 + i] = @truncate(crc_val >> @intCast(i));
    }
}

export fn ldpc_encode(in91: [*]const u8, out174: [*]u8) void {
    var bits91: [91]u1 = undefined;
    for (0..91) |i| bits91[i] = @truncate(in91[i]);
    var bits174: [174]u1 = undefined;
    ft8.ldpc.encode(&bits91, &bits174);
    for (bits174, 0..) |b, i| out174[i] = b;
}

export fn gray_to_symbols(in174: [*]const u8, out58: [*]u8) void {
    for (0..58) |i| {
        const triad: u3 = (@as(u3, @truncate(in174[3 * i])) << 2) |
            (@as(u3, @truncate(in174[3 * i + 1])) << 1) |
            @as(u3, @truncate(in174[3 * i + 2]));
        out58[i] = ft8.gray.bitsToTone(triad);
    }
}

export fn build_frame(in58: [*]const u8, out79: [*]u8) void {
    var sym58: [58]u3 = undefined;
    for (0..58) |i| sym58[i] = @truncate(in58[i]);
    var frame79: [79]u3 = undefined;
    ft8.costas.buildFrame(&sym58, &frame79);
    for (frame79, 0..) |s, i| out79[i] = s;
}

export fn synthesize(in79: [*]const u8, carrier_hz: f32, out_pcm: [*]f32) usize {
    var sym79: [79]u3 = undefined;
    for (0..79) |i| sym79[i] = @truncate(in79[i]);
    const pcm = ft8.gfsk.synthesize(&sym79, carrier_hz, 12000, alloc_mod.allocator) catch return 0;
    @memcpy(out_pcm[0..pcm.len], pcm);
    return pcm.len;
}

export fn encode_standard_to_audio(
    call1: [*]const u8,
    call1_len: usize,
    call2: [*]const u8,
    call2_len: usize,
    grid: [*]const u8,
    grid_len: usize,
    carrier_hz: f32,
    out_pcm: [*]f32,
) bool {
    if (call1_len > 6 or call2_len > 6 or grid_len != 4) return false;
    const pcm = ft8.encodeStandardToAudio(
        call1[0..call1_len],
        call2[0..call2_len],
        grid[0..grid_len],
        carrier_hz,
        12000,
        alloc_mod.allocator,
    ) catch return false;
    @memcpy(out_pcm[0..pcm.len], pcm);
    return true;
}

export fn encode_freetext_to_audio(
    text: [*]const u8,
    text_len: usize,
    carrier_hz: f32,
    out_pcm: [*]f32,
) bool {
    if (text_len > 13) return false;
    const pcm = ft8.encodeFreeTextToAudio(
        text[0..text_len],
        carrier_hz,
        12000,
        alloc_mod.allocator,
    ) catch return false;
    @memcpy(out_pcm[0..pcm.len], pcm);
    return true;
}

// ── RX Pipeline ──────────────────────────────────────────────────────────────

export fn ldpc_decode(
    llr: [*]const f32,
    llr_len: usize,
    out174: [*]u8,
    iterations: u32,
) bool {
    if (llr_len < 174) return false;
    var llr_arr: [174]f32 = undefined;
    @memcpy(&llr_arr, llr[0..174]);
    var bits174: [174]u1 = undefined;
    const ok = ft8.ldpc.decode_bp(&llr_arr, &bits174, iterations);
    for (bits174, 0..) |b, i| out174[i] = b;
    return ok;
}

export fn strip_crc(in91: [*]const u8, out77: [*]u8) void {
    @memcpy(out77[0..77], in91[0..77]);
}

export fn unpack77(in77: [*]const u8, out_msg: [*]u8) usize {
    var bits77: [77]u1 = undefined;
    for (0..77) |i| bits77[i] = @truncate(in77[i]);
    var buf: [64]u8 = undefined;
    const decoded = ft8.message.decode(&bits77, &buf) catch return 0;
    const len = @min(decoded.len, 63);
    @memcpy(out_msg[0..len], decoded[0..len]);
    out_msg[len] = 0; // null terminate
    return len;
}
