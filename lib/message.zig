// SPDX-License-Identifier: MIT
const std = @import("std");

const crc = @import("crc.zig");

// Free-text alphabet: 42 characters, base-42 encoding
const FREETEXT_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ +-./?";
const FREETEXT_BASE: u128 = 42;
const FREETEXT_MAX_LEN: usize = 13;

// Callsign character sets per WSJT-X c28 mixed-base encoding
const C1 = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 37: space + digits + letters
const C2 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 36: digits + letters (no space)
const C3 = "0123456789"; // 10: digits only
const C4 = " ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 27: space + letters

fn charIndex(ch: u8, alphabet: []const u8) !usize {
    for (alphabet, 0..) |c, i| {
        if (c == ch) return i;
    }
    return error.InvalidInput;
}

// Encode up to 13 free-text characters (base-42) into 71 bits, i3=0b000.
pub fn encodeFreeText(text: []const u8, out: *[77]u1) !void {
    if (text.len > FREETEXT_MAX_LEN) return error.InvalidInput;

    // Encode as base-42 integer, LSB first
    var n: u128 = 0;
    var base: u128 = 1;
    for (text) |ch| {
        const idx = try charIndex(ch, FREETEXT_ALPHABET);
        n += @as(u128, idx) * base;
        base *= FREETEXT_BASE;
    }

    // Pad short messages - already 0

    // Write 71 bits
    @memset(out, 0);
    for (0..71) |i| {
        out[i] = @truncate(n >> @intCast(i));
    }
    // i3 = 0b000 (bits 74–76 already 0)
}

// Validate and encode a standard message (Type 1): call1 call2 grid.
// Packing: c28 + r1 + c28 + r1 + R1 + g15 = 77 bits (approximately)
// Simplified: encode call1 as 28-bit hash, call2 as 28-bit hash, grid as 15 bits.
pub fn encodeStandard(
    call1: []const u8,
    call2: []const u8,
    grid: []const u8,
    out: *[77]u1,
) !void {
    if (call1.len < 3 or call1.len > 6) return error.InvalidInput;
    if (call2.len < 3 or call2.len > 6) return error.InvalidInput;
    if (grid.len != 4) return error.InvalidInput;

    // Validate grid: [A-R][A-R][0-9][0-9]
    if (grid[0] < 'A' or grid[0] > 'R') return error.InvalidInput;
    if (grid[1] < 'A' or grid[1] > 'R') return error.InvalidInput;
    if (grid[2] < '0' or grid[2] > '9') return error.InvalidInput;
    if (grid[3] < '0' or grid[3] > '9') return error.InvalidInput;

    const c1 = try packCallsign(call1);
    const c2 = try packCallsign(call2);
    const g = packGrid(grid);

    @memset(out, 0);
    // Pack c1 into bits 0–27 (28 bits)
    for (0..28) |i| {
        out[i] = @truncate(c1 >> @intCast(i));
    }
    // bit 28: r1 flag = 0
    // Pack c2 into bits 29–56 (28 bits)
    for (0..28) |i| {
        out[29 + i] = @truncate(c2 >> @intCast(i));
    }
    // bit 57: r1 flag = 0
    // bit 58: R flag = 0
    // Pack grid into bits 59–73 (15 bits)
    for (0..15) |i| {
        out[59 + i] = @truncate(g >> @intCast(i));
    }
    // bits 74–76: i3 = 0b001 (type 1 standard message)
    out[74] = 1;
    out[75] = 0;
    out[76] = 0;
}

// Normalize a callsign to 6 chars with the digit at position 2 (0-indexed).
// Pads with trailing spaces to 6 chars, then prepends spaces to shift the
// first digit to index 2.
fn normalizeCallsign(call: []const u8, out: *[6]u8) !void {
    var buf: [6]u8 = @splat(' ');
    const n = @min(call.len, 6);
    @memcpy(buf[0..n], call[0..n]);

    // Find position of the first digit
    var digit_pos: ?usize = null;
    for (buf, 0..) |ch, i| {
        if (ch >= '0' and ch <= '9') {
            digit_pos = i;
            break;
        }
    }
    const dp = digit_pos orelse return error.InvalidInput;
    if (dp > 2) return error.InvalidInput; // digit too far right for standard callsign

    // Shift right by (2 - dp) to put the digit at position 2
    const shift = 2 - dp;
    var i: usize = 5;
    while (true) {
        if (i >= shift) {
            out[i] = buf[i - shift];
        }
        if (i == 0) break;
        i -= 1;
    }
    @memset(out[0..shift], ' ');
}

// Pack a callsign into a 28-bit integer using WSJT-X c28 mixed-base encoding.
// Max value = 37*36*10*27*27*27 = 262,177,560 < 2^28 (268,435,456).
fn packCallsign(call: []const u8) !u32 {
    var norm: [6]u8 = undefined;
    try normalizeCallsign(call, &norm);

    const p0 = try charIndex(norm[0], C1);
    const p1 = try charIndex(norm[1], C2);
    const p2 = try charIndex(norm[2], C3);
    const p3 = try charIndex(norm[3], C4);
    const p4 = try charIndex(norm[4], C4);
    const p5 = try charIndex(norm[5], C4);

    var n: u32 = @intCast(p0);
    n = n * 36 + @as(u32, @intCast(p1));
    n = n * 10 + @as(u32, @intCast(p2));
    n = n * 27 + @as(u32, @intCast(p3));
    n = n * 27 + @as(u32, @intCast(p4));
    n = n * 27 + @as(u32, @intCast(p5));
    return n; // guaranteed < 2^28
}

// Pack a 4-char Maidenhead grid locator into 15 bits.
// lat = (grid[1]-'A')*10 + (grid[3]-'0')
// lon = (grid[0]-'A')*20 + (grid[2]-'0')*2
// pack = lon * 180 + lat (fits in 15 bits: max = 39*20*2 * 180 + ... actually just mask)
fn packGrid(grid: []const u8) u15 {
    const lat: u15 = @intCast((@as(u15, grid[1] - 'A') * 10) + (grid[3] - '0'));
    const lon: u15 = @intCast((@as(u15, grid[0] - 'A') * 20) + ((grid[2] - '0') * 2));
    const n: u32 = @as(u32, lon) * 180 + lat;
    return @truncate(n & 0x7FFF);
}

// Decode 77 bits → message string.
pub fn decode(bits: []const u1, buf: []u8) ![]u8 {
    if (bits.len < 77) return error.InvalidInput;

    // Check i3 field (bits 74–76)
    const msg_type: u3 = (@as(u3, bits[76]) << 2) | (@as(u3, bits[75]) << 1) | @as(u3, bits[74]);

    if (msg_type == 0b000) {
        return decodeFreeText(bits, buf);
    } else if (msg_type == 0b001) {
        return decodeStandard(bits, buf);
    }
    return error.InvalidInput;
}

fn decodeFreeText(bits: []const u1, buf: []u8) ![]u8 {
    var n: u128 = 0;
    for (0..71) |i| {
        n |= @as(u128, bits[i]) << @intCast(i);
    }

    var text: [FREETEXT_MAX_LEN]u8 = undefined;
    var len: usize = 0;
    var remaining = n;
    while (remaining > 0 and len < FREETEXT_MAX_LEN) {
        const idx: usize = @intCast(remaining % FREETEXT_BASE);
        text[len] = FREETEXT_ALPHABET[idx];
        remaining /= FREETEXT_BASE;
        len += 1;
    }

    // No reverse: encoding stored text[0] as LSB, decode recovers same order

    if (buf.len < len) return error.InvalidInput;
    @memcpy(buf[0..len], text[0..len]);
    return buf[0..len];
}

fn decodeStandard(bits: []const u1, buf: []u8) ![]u8 {
    // Extract c1 (bits 0–27)
    var c1: u32 = 0;
    for (0..28) |i| {
        c1 |= @as(u32, bits[i]) << @intCast(i);
    }
    // Extract c2 (bits 29–56)
    var c2: u32 = 0;
    for (0..28) |i| {
        c2 |= @as(u32, bits[29 + i]) << @intCast(i);
    }
    // Extract grid (bits 59–73)
    var g: u15 = 0;
    for (0..15) |i| {
        g |= @as(u15, bits[59 + i]) << @intCast(i);
    }

    var call1_buf: [8]u8 = undefined;
    var call2_buf: [8]u8 = undefined;
    var grid_buf: [5]u8 = undefined;

    const s1 = try unpackCallsign(c1, &call1_buf);
    const s2 = try unpackCallsign(c2, &call2_buf);
    const sg = unpackGrid(g, &grid_buf);

    const result = try std.fmt.bufPrint(buf, "{s} {s} {s}", .{ s1, s2, sg });
    return result;
}

fn unpackCallsign(n_in: u32, buf: *[8]u8) ![]u8 {
    var n = n_in;
    var chars: [6]u8 = undefined;

    // Reverse of packCallsign mixed-base: extract positions 5→0
    chars[5] = C4[n % 27];
    n /= 27;
    chars[4] = C4[n % 27];
    n /= 27;
    chars[3] = C4[n % 27];
    n /= 27;
    chars[2] = C3[n % 10];
    n /= 10;
    chars[1] = C2[n % 36];
    n /= 36;
    chars[0] = C1[n % 37];

    // Strip leading spaces (added by normalization)
    var start: usize = 0;
    while (start < 6 and chars[start] == ' ') start += 1;
    // Strip trailing spaces
    var end: usize = 6;
    while (end > start and chars[end - 1] == ' ') end -= 1;

    const result_len = end - start;
    @memcpy(buf[0..result_len], chars[start..end]);
    return buf[0..result_len];
}

fn unpackGrid(g: u15, buf: *[5]u8) []u8 {
    const lon: u15 = g / 180;
    const lat: u15 = g % 180;
    buf[0] = 'A' + @as(u8, @intCast(lon / 20));
    buf[1] = 'A' + @as(u8, @intCast(lat / 10));
    buf[2] = '0' + @as(u8, @intCast((lon % 20) / 2));
    buf[3] = '0' + @as(u8, @intCast(lat % 10));
    return buf[0..4];
}
