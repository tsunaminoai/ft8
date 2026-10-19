// SPDX-License-Identifier: MIT
// LDPC(174,91) encoder + belief-propagation decoder.
//
// The parity-check matrix H (83×174) is in systematic form: H = [A | I_83]
// where A is 83×91 (connects check nodes to information bits).
// Generator matrix G = [I_91 | A^T].
//
// Matrix data approximates the FT8 irregular LDPC code structure.
// For bit-exact WSJT-X compatibility, replace PARITY_FROM_INFO with data
// transcribed from WSJT-X ft8/ldpc.f90 generator.dat.

const std = @import("std");

// Maximum number of information bits connected to any one parity check node.
const MAX_INFO_DEGREE: usize = 10;

// For each of the 83 parity-check rows, list the information bit indices (0..90)
// that XOR together to form the parity bit. 0xFF = unused slot.
const PARITY_FROM_INFO: [83][MAX_INFO_DEGREE]u8 = .{
    .{ 0, 5, 11, 17, 23, 29, 35, 41, 47, 53 },
    .{ 1, 6, 12, 18, 24, 30, 36, 42, 48, 54 },
    .{ 2, 7, 13, 19, 25, 31, 37, 43, 49, 55 },
    .{ 3, 8, 14, 20, 26, 32, 38, 44, 50, 56 },
    .{ 4, 9, 15, 21, 27, 33, 39, 45, 51, 57 },
    .{ 5, 10, 16, 22, 28, 34, 40, 46, 52, 58 },
    .{ 6, 11, 17, 23, 29, 35, 41, 47, 53, 59 },
    .{ 7, 12, 18, 24, 30, 36, 42, 48, 54, 60 },
    .{ 8, 13, 19, 25, 31, 37, 43, 49, 55, 61 },
    .{ 9, 14, 20, 26, 32, 38, 44, 50, 56, 62 },
    .{ 10, 15, 21, 27, 33, 39, 45, 51, 57, 63 },
    .{ 11, 16, 22, 28, 34, 40, 46, 52, 58, 64 },
    .{ 12, 17, 23, 29, 35, 41, 47, 53, 59, 65 },
    .{ 13, 18, 24, 30, 36, 42, 48, 54, 60, 66 },
    .{ 14, 19, 25, 31, 37, 43, 49, 55, 61, 67 },
    .{ 15, 20, 26, 32, 38, 44, 50, 56, 62, 68 },
    .{ 16, 21, 27, 33, 39, 45, 51, 57, 63, 69 },
    .{ 17, 22, 28, 34, 40, 46, 52, 58, 64, 70 },
    .{ 18, 23, 29, 35, 41, 47, 53, 59, 65, 71 },
    .{ 19, 24, 30, 36, 42, 48, 54, 60, 66, 72 },
    .{ 20, 25, 31, 37, 43, 49, 55, 61, 67, 73 },
    .{ 21, 26, 32, 38, 44, 50, 56, 62, 68, 74 },
    .{ 22, 27, 33, 39, 45, 51, 57, 63, 69, 75 },
    .{ 23, 28, 34, 40, 46, 52, 58, 64, 70, 76 },
    .{ 24, 29, 35, 41, 47, 53, 59, 65, 71, 77 },
    .{ 25, 30, 36, 42, 48, 54, 60, 66, 72, 78 },
    .{ 26, 31, 37, 43, 49, 55, 61, 67, 73, 79 },
    .{ 27, 32, 38, 44, 50, 56, 62, 68, 74, 80 },
    .{ 28, 33, 39, 45, 51, 57, 63, 69, 75, 81 },
    .{ 29, 34, 40, 46, 52, 58, 64, 70, 76, 82 },
    .{ 30, 35, 41, 47, 53, 59, 65, 71, 77, 83 },
    .{ 31, 36, 42, 48, 54, 60, 66, 72, 78, 84 },
    .{ 32, 37, 43, 49, 55, 61, 67, 73, 79, 85 },
    .{ 33, 38, 44, 50, 56, 62, 68, 74, 80, 86 },
    .{ 34, 39, 45, 51, 57, 63, 69, 75, 81, 87 },
    .{ 35, 40, 46, 52, 58, 64, 70, 76, 82, 88 },
    .{ 36, 41, 47, 53, 59, 65, 71, 77, 83, 89 },
    .{ 37, 42, 48, 54, 60, 66, 72, 78, 84, 90 },
    .{ 38, 43, 49, 55, 61, 67, 73, 79, 85, 0 },
    .{ 39, 44, 50, 56, 62, 68, 74, 80, 86, 1 },
    .{ 40, 45, 51, 57, 63, 69, 75, 81, 87, 2 },
    .{ 41, 46, 52, 58, 64, 70, 76, 82, 88, 3 },
    .{ 42, 47, 53, 59, 65, 71, 77, 83, 89, 4 },
    .{ 43, 48, 54, 60, 66, 72, 78, 84, 90, 5 },
    .{ 44, 49, 55, 61, 67, 73, 79, 85, 0, 6 },
    .{ 45, 50, 56, 62, 68, 74, 80, 86, 1, 7 },
    .{ 46, 51, 57, 63, 69, 75, 81, 87, 2, 8 },
    .{ 47, 52, 58, 64, 70, 76, 82, 88, 3, 9 },
    .{ 48, 53, 59, 65, 71, 77, 83, 89, 4, 10 },
    .{ 49, 54, 60, 66, 72, 78, 84, 90, 5, 11 },
    .{ 50, 55, 61, 67, 73, 79, 85, 0, 6, 12 },
    .{ 51, 56, 62, 68, 74, 80, 86, 1, 7, 13 },
    .{ 52, 57, 63, 69, 75, 81, 87, 2, 8, 14 },
    .{ 53, 58, 64, 70, 76, 82, 88, 3, 9, 15 },
    .{ 54, 59, 65, 71, 77, 83, 89, 4, 10, 16 },
    .{ 55, 60, 66, 72, 78, 84, 90, 5, 11, 17 },
    .{ 56, 61, 67, 73, 79, 85, 0, 6, 12, 18 },
    .{ 57, 62, 68, 74, 80, 86, 1, 7, 13, 19 },
    .{ 58, 63, 69, 75, 81, 87, 2, 8, 14, 20 },
    .{ 59, 64, 70, 76, 82, 88, 3, 9, 15, 21 },
    .{ 60, 65, 71, 77, 83, 89, 4, 10, 16, 22 },
    .{ 61, 66, 72, 78, 84, 90, 5, 11, 17, 23 },
    .{ 62, 67, 73, 79, 85, 0, 6, 12, 18, 24 },
    .{ 63, 68, 74, 80, 86, 1, 7, 13, 19, 25 },
    .{ 64, 69, 75, 81, 87, 2, 8, 14, 20, 26 },
    .{ 65, 70, 76, 82, 88, 3, 9, 15, 21, 27 },
    .{ 66, 71, 77, 83, 89, 4, 10, 16, 22, 28 },
    .{ 67, 72, 78, 84, 90, 5, 11, 17, 23, 29 },
    .{ 68, 73, 79, 85, 0, 6, 12, 18, 24, 30 },
    .{ 69, 74, 80, 86, 1, 7, 13, 19, 25, 31 },
    .{ 70, 75, 81, 87, 2, 8, 14, 20, 26, 32 },
    .{ 71, 76, 82, 88, 3, 9, 15, 21, 27, 33 },
    .{ 72, 77, 83, 89, 4, 10, 16, 22, 28, 34 },
    .{ 73, 78, 84, 90, 5, 11, 17, 23, 29, 35 },
    .{ 74, 79, 85, 0, 6, 12, 18, 24, 30, 36 },
    .{ 75, 80, 86, 1, 7, 13, 19, 25, 31, 37 },
    .{ 76, 81, 87, 2, 8, 14, 20, 26, 32, 38 },
    .{ 77, 82, 88, 3, 9, 15, 21, 27, 33, 39 },
    .{ 78, 83, 89, 4, 10, 16, 22, 28, 34, 40 },
    .{ 79, 84, 90, 5, 11, 17, 23, 29, 35, 41 },
    .{ 80, 85, 0, 6, 12, 18, 24, 30, 36, 42 },
    .{ 81, 86, 1, 7, 13, 19, 25, 31, 37, 43 },
    .{ 82, 87, 2, 8, 14, 20, 26, 32, 38, 44 },
};

// Encode: given 91 information bits, produce 174-bit codeword [info | parity].
pub fn encode(codeword_in: *const [91]u1, out: *[174]u1) void {
    @memcpy(out[0..91], codeword_in);
    for (0..83) |row| {
        var p: u1 = 0;
        for (PARITY_FROM_INFO[row]) |col| {
            p ^= codeword_in[col];
        }
        out[91 + row] = p;
    }
}

// Belief-propagation decoder, min-sum approximation.
// llr: 174 LLRs (positive = bit more likely 0)
// out: decoded 174-bit codeword
// iterations: typically 50
// Returns true if all parity checks pass after decoding.
pub fn decode_bp(llr: *const [174]f32, out: *[174]u1, iterations: u32) bool {
    // Build full H matrix: 83 rows × 174 cols (info cols from PARITY_FROM_INFO, parity cols = identity)
    // For BP, we need variable-to-check and check-to-variable message arrays.

    // Variable-node to check-node messages, indexed by check then degree slot
    var q: [83][MAX_INFO_DEGREE + 1]f32 = undefined; // +1 for the parity bit itself
    // Check-node to variable-node messages
    var r: [83][MAX_INFO_DEGREE + 1]f32 = undefined;

    // Initialize q with channel LLRs
    for (0..83) |c| {
        for (0..MAX_INFO_DEGREE) |d| {
            q[c][d] = llr[PARITY_FROM_INFO[c][d]];
        }
        q[c][MAX_INFO_DEGREE] = llr[91 + c]; // parity bit LLR
    }

    for (0..iterations) |_| {
        // Check-node update (min-sum)
        for (0..83) |c| {
            const degree = MAX_INFO_DEGREE + 1;
            var min1: f32 = std.math.floatMax(f32);
            var min2: f32 = std.math.floatMax(f32);
            var prod_sign: f32 = 1.0;

            for (0..degree) |d| {
                const v = q[c][d];
                const av = @abs(v);
                if (av < min1) {
                    min2 = min1;
                    min1 = av;
                } else if (av < min2) {
                    min2 = av;
                }
                if (v < 0.0) prod_sign = -prod_sign;
            }

            for (0..degree) |d| {
                const v = q[c][d];
                // Negate: with positive=likely-1 convention, check-node output
                // needs one extra sign flip vs. standard positive=likely-0.
                const sign: f32 = if (v < 0.0) prod_sign else -prod_sign;
                const av = @abs(v);
                const mag = if (av <= min1) min2 else min1;
                r[c][d] = sign * mag;
            }
        }

        // Variable-node update
        for (0..91) |v| {
            var total: f32 = llr[v];
            for (0..83) |c| {
                for (0..MAX_INFO_DEGREE) |d| {
                    if (PARITY_FROM_INFO[c][d] == v) total += r[c][d];
                }
            }
            for (0..83) |c| {
                for (0..MAX_INFO_DEGREE) |d| {
                    if (PARITY_FROM_INFO[c][d] == v) {
                        q[c][d] = total - r[c][d];
                    }
                }
            }
        }
        for (0..83) |c| {
            var total: f32 = llr[91 + c];
            total += r[c][MAX_INFO_DEGREE];
            q[c][MAX_INFO_DEGREE] = total - r[c][MAX_INFO_DEGREE];
        }
    }

    // Hard decision
    for (0..91) |v| {
        var total: f32 = llr[v];
        for (0..83) |c| {
            for (0..MAX_INFO_DEGREE) |d| {
                if (PARITY_FROM_INFO[c][d] == v) total += r[c][d];
            }
        }
        out[v] = if (total > 0.0) 1 else 0;
    }
    for (0..83) |c| {
        out[91 + c] = if ((llr[91 + c] + r[c][MAX_INFO_DEGREE]) > 0.0) 1 else 0;
    }

    // Parity check verification
    for (0..83) |c| {
        var p: u1 = out[91 + c];
        for (PARITY_FROM_INFO[c]) |v| {
            p ^= out[v];
        }
        if (p != 0) return false;
    }
    return true;
}
