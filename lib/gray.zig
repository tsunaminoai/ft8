// SPDX-License-Identifier: MIT

// 3-bit Gray code mapping.
// Table: bits(index) → tone
// 000→0, 001→1, 010→3, 011→2, 100→5, 101→6, 110→4, 111→7
const GRAY_TABLE: [8]u3 = .{ 0, 1, 3, 2, 5, 6, 4, 7 };
// Inverse: tone(index) → bits
const INV_GRAY: [8]u3 = .{ 0, 1, 3, 2, 6, 4, 5, 7 };

pub fn bitsToTone(bits: u3) u3 {
    return GRAY_TABLE[bits];
}

pub fn toneToBits(tone: u3) u3 {
    return INV_GRAY[tone];
}
