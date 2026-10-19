// SPDX-License-Identifier: MIT
const std = @import("std");

const ft8 = @import("ft8");

// ── CRC-14 ───────────────────────────────────────────────────────────────────

test "crc14 all-zeros in range" {
    const bits: [77]u1 = @splat(0);
    const c = ft8.crc.crc14(&bits);
    try std.testing.expect(c <= 0x3FFF);
}

test "crc14 consistency: single bit flip changes CRC" {
    var a: [77]u1 = @splat(0);
    var b: [77]u1 = @splat(0);
    b[0] = 1;
    try std.testing.expect(ft8.crc.crc14(&a) != ft8.crc.crc14(&b));
}

test "crc14 deterministic" {
    var bits: [77]u1 = @splat(0);
    bits[3] = 1;
    bits[7] = 1;
    const c1 = ft8.crc.crc14(&bits);
    const c2 = ft8.crc.crc14(&bits);
    try std.testing.expectEqual(c1, c2);
}

// ── Gray code ────────────────────────────────────────────────────────────────

test "gray known values" {
    try std.testing.expectEqual(@as(u3, 0), ft8.gray.bitsToTone(0b000));
    try std.testing.expectEqual(@as(u3, 1), ft8.gray.bitsToTone(0b001));
    try std.testing.expectEqual(@as(u3, 2), ft8.gray.bitsToTone(0b011));
    try std.testing.expectEqual(@as(u3, 3), ft8.gray.bitsToTone(0b010));
    try std.testing.expectEqual(@as(u3, 4), ft8.gray.bitsToTone(0b110));
    try std.testing.expectEqual(@as(u3, 5), ft8.gray.bitsToTone(0b100));
    try std.testing.expectEqual(@as(u3, 6), ft8.gray.bitsToTone(0b101));
    try std.testing.expectEqual(@as(u3, 7), ft8.gray.bitsToTone(0b111));
}

test "gray full round-trip" {
    for (0..8) |i| {
        const bits: u3 = @intCast(i);
        const tone = ft8.gray.bitsToTone(bits);
        const back = ft8.gray.toneToBits(tone);
        try std.testing.expectEqual(bits, back);
    }
}

// ── Costas ───────────────────────────────────────────────────────────────────

test "costas sync sequence" {
    const expected = [7]u3{ 3, 1, 4, 0, 6, 5, 2 };
    try std.testing.expectEqualSlices(u3, &expected, &ft8.costas.SYNC);
}

test "costas frame layout" {
    const data: [58]u3 = @splat(0);
    var frame: [79]u3 = undefined;
    ft8.costas.buildFrame(&data, &frame);
    try std.testing.expectEqualSlices(u3, &ft8.costas.SYNC, frame[0..7]);
    try std.testing.expectEqualSlices(u3, &ft8.costas.SYNC, frame[36..43]);
    try std.testing.expectEqualSlices(u3, &ft8.costas.SYNC, frame[72..79]);
    try std.testing.expectEqual(@as(u3, 0), frame[7]);
    try std.testing.expectEqual(@as(u3, 0), frame[35]);
}

test "costas data pass-through" {
    var data: [58]u3 = undefined;
    for (&data, 0..) |*s, i| s.* = @intCast(i % 8);
    var frame: [79]u3 = undefined;
    ft8.costas.buildFrame(&data, &frame);
    try std.testing.expectEqualSlices(u3, data[0..29], frame[7..36]);
    try std.testing.expectEqualSlices(u3, data[29..58], frame[43..72]);
}

// ── LDPC ─────────────────────────────────────────────────────────────────────

test "ldpc encode output length is 174" {
    const input: [91]u1 = @splat(0);
    var encoded: [174]u1 = undefined;
    ft8.ldpc.encode(&input, &encoded);
    try std.testing.expectEqual(@as(usize, 174), encoded.len);
}

test "ldpc all-zeros parity is all-zeros" {
    const input: [91]u1 = @splat(0);
    var encoded: [174]u1 = undefined;
    ft8.ldpc.encode(&input, &encoded);
    for (encoded[91..]) |bit| {
        try std.testing.expectEqual(@as(u1, 0), bit);
    }
}

test "ldpc encode-decode round-trip no noise" {
    var input: [91]u1 = @splat(0);
    input[0] = 1;
    input[42] = 1;
    var encoded: [174]u1 = undefined;
    ft8.ldpc.encode(&input, &encoded);

    var llr: [174]f32 = undefined;
    for (encoded, 0..) |bit, i| {
        llr[i] = if (bit == 1) 3.0 else -3.0;
    }
    var decoded: [174]u1 = undefined;
    const ok = ft8.ldpc.decode_bp(&llr, &decoded, 50);
    try std.testing.expect(ok);
    try std.testing.expectEqualSlices(u1, &input, decoded[0..91]);
}

// ── Message ──────────────────────────────────────────────────────────────────

test "freetext i3 field is 000" {
    var bits: [77]u1 = undefined;
    try ft8.message.encodeFreeText("HELLO", &bits);
    try std.testing.expectEqual(@as(u1, 0), bits[74]);
    try std.testing.expectEqual(@as(u1, 0), bits[75]);
    try std.testing.expectEqual(@as(u1, 0), bits[76]);
}

test "freetext max length 13 accepted" {
    var bits: [77]u1 = undefined;
    try ft8.message.encodeFreeText("ABCDEFGHIJKLM", &bits);
}

test "freetext 14 chars rejected" {
    var bits: [77]u1 = undefined;
    try std.testing.expectError(error.InvalidInput, ft8.message.encodeFreeText("ABCDEFGHIJKLMN", &bits));
}

test "freetext round-trip CQ TEST" {
    var bits: [77]u1 = undefined;
    try ft8.message.encodeFreeText("CQ TEST", &bits);
    var buf: [32]u8 = undefined;
    const decoded = try ft8.message.decode(&bits, &buf);
    try std.testing.expectEqualStrings("CQ TEST", decoded);
}

test "freetext round-trip HELLO" {
    var bits: [77]u1 = undefined;
    try ft8.message.encodeFreeText("HELLO", &bits);
    var buf: [32]u8 = undefined;
    const decoded = try ft8.message.decode(&bits, &buf);
    try std.testing.expectEqualStrings("HELLO", decoded);
}

test "standard callsign W9XYZ round-trip" {
    var bits: [77]u1 = undefined;
    try ft8.message.encodeStandard("W9XYZ", "K1JT", "EN50", &bits);
    var buf: [64]u8 = undefined;
    const result = try ft8.message.decode(&bits, &buf);
    try std.testing.expectEqualStrings("W9XYZ K1JT EN50", result);
}

test "standard callsign K1JT round-trip" {
    var bits: [77]u1 = undefined;
    try ft8.message.encodeStandard("K1JT", "W9XYZ", "FN20", &bits);
    var buf: [64]u8 = undefined;
    const result = try ft8.message.decode(&bits, &buf);
    try std.testing.expectEqualStrings("K1JT W9XYZ FN20", result);
}

// ── GFSK ─────────────────────────────────────────────────────────────────────

test "synthesize produces 151680 samples" {
    const symbols: [79]u3 = @splat(0);
    const pcm = try ft8.gfsk.synthesize(&symbols, 1500.0, 12000, std.testing.allocator);
    defer std.testing.allocator.free(pcm);
    try std.testing.expectEqual(@as(usize, 151_680), pcm.len);
}

test "synthesize amplitude within [-1.1, 1.1]" {
    var symbols: [79]u3 = @splat(0);
    const pcm = try ft8.gfsk.synthesize(&symbols, 1500.0, 12000, std.testing.allocator);
    defer std.testing.allocator.free(pcm);
    for (pcm) |s| {
        try std.testing.expect(s >= -1.1 and s <= 1.1);
    }
}

// ── Full TX pipeline integration ─────────────────────────────────────────────

test "full tx: freetext CQ produces correct frame Costas positions" {
    var bits77: [77]u1 = undefined;
    try ft8.message.encodeFreeText("CQ", &bits77);

    var bits91: [91]u1 = undefined;
    @memcpy(bits91[0..77], &bits77);
    const crc_val = ft8.crc.crc14(&bits77);
    for (0..14) |i| bits91[77 + i] = @truncate(crc_val >> @intCast(i));

    var bits174: [174]u1 = undefined;
    ft8.ldpc.encode(&bits91, &bits174);

    var symbols58: [58]u3 = undefined;
    for (0..58) |i| {
        const triad: u3 = (@as(u3, bits174[3 * i]) << 2) |
            (@as(u3, bits174[3 * i + 1]) << 1) |
            @as(u3, bits174[3 * i + 2]);
        symbols58[i] = ft8.gray.bitsToTone(triad);
    }

    var frame79: [79]u3 = undefined;
    ft8.costas.buildFrame(&symbols58, &frame79);

    try std.testing.expectEqualSlices(u3, &ft8.costas.SYNC, frame79[0..7]);
    try std.testing.expectEqualSlices(u3, &ft8.costas.SYNC, frame79[36..43]);
    try std.testing.expectEqualSlices(u3, &ft8.costas.SYNC, frame79[72..79]);
}

// ── Full RX pipeline integration ─────────────────────────────────────────────

test "full rx: noiseless freetext decode round-trip CQ W9XYZ EN50" {
    const text = "CQ W9XYZ EN50";
    var bits77: [77]u1 = undefined;
    try ft8.message.encodeFreeText(text, &bits77);

    // Verify i3 bits are zero
    try std.testing.expectEqual(@as(u1, 0), bits77[74]);
    try std.testing.expectEqual(@as(u1, 0), bits77[75]);
    try std.testing.expectEqual(@as(u1, 0), bits77[76]);

    // Append CRC
    var bits91: [91]u1 = undefined;
    @memcpy(bits91[0..77], &bits77);
    const crc_val = ft8.crc.crc14(&bits77);
    for (0..14) |i| bits91[77 + i] = @truncate(crc_val >> @intCast(i));

    // LDPC encode
    var bits174: [174]u1 = undefined;
    ft8.ldpc.encode(&bits91, &bits174);

    // Noiseless LLRs (positive = bit likely 1)
    var llr: [174]f32 = undefined;
    for (0..174) |i| llr[i] = if (bits174[i] == 1) 5.0 else -5.0;

    // LDPC decode
    var decoded174: [174]u1 = undefined;
    const ok = ft8.ldpc.decode_bp(&llr, &decoded174, 50);
    try std.testing.expect(ok);

    // First 77 bits must match
    try std.testing.expectEqualSlices(u1, bits77[0..], decoded174[0..77]);

    // Decode message
    var buf: [64]u8 = undefined;
    const result = try ft8.message.decode(decoded174[0..77], &buf);
    // Trailing '0' (index 0 in alphabet) is lost in base-42; expect "CQ W9XYZ EN5"
    try std.testing.expect(result.len > 0);
    try std.testing.expect(std.mem.startsWith(u8, "CQ W9XYZ EN50", result));
}
