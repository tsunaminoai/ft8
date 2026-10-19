// SPDX-License-Identifier: MIT

// Costas sync array for FT8: [3,1,4,0,6,5,2].
// Inserted at positions [0..6], [36..42], [72..78] in the 79-symbol frame.

pub const SYNC: [7]u3 = .{ 3, 1, 4, 0, 6, 5, 2 };

// Build the 79-symbol frame by inserting three Costas arrays around the 58 data symbols.
// Frame layout:
//   [0..6]   = SYNC (Costas A)
//   [7..35]  = data[0..28]
//   [36..42] = SYNC (Costas B)
//   [43..71] = data[29..57]
//   [72..78] = SYNC (Costas C)
pub fn buildFrame(data: *const [58]u3, out: *[79]u3) void {
    @memcpy(out[0..7], &SYNC);
    @memcpy(out[7..36], data[0..29]);
    @memcpy(out[36..43], &SYNC);
    @memcpy(out[43..72], data[29..58]);
    @memcpy(out[72..79], &SYNC);
}
