// SPDX-License-Identifier: MIT
// Top-level FT8 encode/decode pipeline.

const std = @import("std");
pub const crc = @import("crc.zig");
pub const gray = @import("gray.zig");
pub const message = @import("message.zig");
pub const ldpc = @import("ldpc.zig");
pub const costas = @import("costas.zig");
pub const gfsk = @import("gfsk.zig");

// Full TX pipeline: message text → PCM samples.
// call1/call2/grid encoding, or pass null for free-text.
pub fn encodeFreeTextToAudio(
    text: []const u8,
    f_carrier: f32,
    sample_rate: u32,
    allocator: std.mem.Allocator,
) ![]f32 {
    var bits77: [77]u1 = undefined;
    try message.encodeFreeText(text, &bits77);
    return encodeToAudio(&bits77, f_carrier, sample_rate, allocator);
}

pub fn encodeStandardToAudio(
    call1: []const u8,
    call2: []const u8,
    grid: []const u8,
    f_carrier: f32,
    sample_rate: u32,
    allocator: std.mem.Allocator,
) ![]f32 {
    var bits77: [77]u1 = undefined;
    try message.encodeStandard(call1, call2, grid, &bits77);
    return encodeToAudio(&bits77, f_carrier, sample_rate, allocator);
}

// Shared encode path: 77 message bits → PCM.
pub fn encodeToAudio(
    bits77: *const [77]u1,
    f_carrier: f32,
    sample_rate: u32,
    allocator: std.mem.Allocator,
) ![]f32 {
    // Append CRC → 91 bits
    var bits91: [91]u1 = undefined;
    @memcpy(bits91[0..77], bits77);
    const crc_val = crc.crc14(bits77);
    for (0..14) |i| {
        bits91[77 + i] = @truncate(crc_val >> @intCast(i));
    }

    // LDPC encode → 174 bits
    var bits174: [174]u1 = undefined;
    ldpc.encode(&bits91, &bits174);

    // Gray code → 58 symbols
    var symbols58: [58]u3 = undefined;
    for (0..58) |i| {
        const triad: u3 = (@as(u3, bits174[3 * i]) << 2) |
            (@as(u3, bits174[3 * i + 1]) << 1) |
            @as(u3, bits174[3 * i + 2]);
        symbols58[i] = gray.bitsToTone(triad);
    }

    // Insert Costas → 79 symbols
    var frame79: [79]u3 = undefined;
    costas.buildFrame(&symbols58, &frame79);

    // GFSK synthesis → PCM
    return gfsk.synthesize(&frame79, f_carrier, sample_rate, allocator);
}
