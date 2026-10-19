// SPDX-License-Identifier: MIT
// CRC-14 for FT8.
// Full polynomial: g(x) = 0x6757 (includes leading x^14 term).
// XOR value applied to 14-bit shift register: 0x6757 & 0x3FFF = 0x2757.
// Process MSB first, init=0, zero-extend 77 input bits to 82 before computing.

pub fn crc14(bits: []const u1) u14 {
    var padded: [82]u1 = @splat(0);
    const copy_len = @min(bits.len, 77);
    @memcpy(padded[0..copy_len], bits[0..copy_len]);

    var crc: u14 = 0;
    for (padded) |b| {
        const feedback: u1 = @truncate((crc >> 13) ^ b);
        crc = @truncate(crc << 1);
        if (feedback == 1) {
            crc ^= 0x2757; // 0x6757 & 0x3FFF - lower 14 bits of the polynomial
        }
    }
    return crc;
}
