// SPDX-License-Identifier: MIT
const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Native static library (for tests)
    const lib = b.addLibrary(.{
        .name = "ft8",
        .root_module = b.createModule(.{
            .root_source_file = b.path("lib/ft8.zig"),
            .target = target,
            .optimize = optimize,
        }),
        .linkage = .static,
    });
    b.installArtifact(lib);

    // WASM shared library
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });
    const wasm = b.addExecutable(.{
        .name = "ft8",
        .root_module = b.createModule(.{
            .root_source_file = b.path("wasm/bindings.zig"),
            .target = wasm_target,
            .optimize = .ReleaseSafe,
        }),
    });
    wasm.root_module.addImport("ft8", lib.root_module);
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    const wasm_install = b.addInstallArtifact(wasm, .{
        .dest_dir = .{ .override = .{ .custom = "../web" } },
    });

    const wasm_step = b.step("wasm", "Build ft8.wasm");
    wasm_step.dependOn(&wasm_install.step);

    // Unit tests
    const unit_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("test/ft8_test.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    unit_tests.root_module.addImport("ft8", lib.root_module);
    const run_tests = b.addRunArtifact(unit_tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_tests.step);

    // Webapp step: depends on wasm
    const webapp_step = b.step("webapp", "Build WASM + copy to web/");
    webapp_step.dependOn(wasm_step);
}
