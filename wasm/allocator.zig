// SPDX-License-Identifier: MIT
// Fixed-buffer arena allocator for wasm32-freestanding.
// 4 MiB is sufficient for 151,680 × f32 (≈600 KiB) plus headroom.

const std = @import("std");
pub const std_options = std.Options{ .io_mode = .blocking };

var heap: [4 * 1024 * 1024]u8 = undefined;
var fba = std.heap.FixedBufferAllocator.init(&heap);
pub const allocator = fba.allocator();

pub export fn arena_reset() void {
    fba.reset();
}
