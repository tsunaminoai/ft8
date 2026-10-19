{
  description = "FT8 digital radio mode library and interactive demo";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    zig2nix.url = "github:Cloudef/zig2nix";
    zig2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = {
    self,
    nixpkgs,
    zig2nix,
  }: let
    supportedSystems = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
    forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
  in {
    packages = forAllSystems (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
        zig-env = zig2nix.outputs.zig-env.${system} {
          zig = zig2nix.outputs.packages.${system}.zig-0_17_0;
        };
      in {
        # Native static library - libft8.a
        ft8-lib = pkgs.stdenv.mkDerivation {
          name = "ft8-lib";
          version = "0.1.0";
          src = self;

          nativeBuildInputs = [zig-env.zig];

          meta = {
            description = "FT8(174,91) encode/decode static library";
            license = pkgs.lib.licenses.mit;
          };

          buildPhase = ''
            export HOME=$TMPDIR
            zig build
          '';

          installPhase = ''
            mkdir -p $out/lib $out/include
            cp zig-out/lib/libft8.a $out/lib/
            cp lib/ft8.h            $out/include/
          '';
        };

        # Static webapp - pure files, cache-busted asset references
        ft8-webapp = pkgs.stdenv.mkDerivation {
          name = "ft8-webapp";
          version = "0.1.0";
          src = self;

          nativeBuildInputs = [
            zig-env.zig
            pkgs.python3
          ];

          meta = {
            description = "FT8 demo static webapp (cache-busted)";
            license = pkgs.lib.licenses.mit;
          };

          buildPhase = ''
            export HOME=$TMPDIR
            zig build wasm
          '';

          installPhase = ''
            mkdir -p $out

            # Stable content hash from all web source files (pre-copy, pre-rewrite)
            HASH=$(find web -type f | sort | xargs sha256sum | sha256sum | cut -c1-8)

            cp -r web/. $out/

            python3 - "$HASH" "$out" <<'PYEOF'
              import sys, os, re

              v   = sys.argv[1]
              out = sys.argv[2]

              # index.html: bust <link href="style.css"> and <script src="app.js">
              path = os.path.join(out, 'index.html')
              c = open(path).read()
              c = re.sub(r'href="style\.css"', f'href="style.css?v={v}"', c)
              c = re.sub(r'src="app\.js"',     f'src="app.js?v={v}"',     c)
              open(path, 'w').write(c)

              # All .js files: dynamic import('./foo.js') and fetch('ft8.wasm')
              for fname in os.listdir(out):
                  if not fname.endswith('.js'):
                      continue
                  path = os.path.join(out, fname)
                  c = open(path).read()
                  c = re.sub(
                      r"import\('(\./[^'?]+)'\)",
                      lambda m: f"import('{m.group(1)}?v={v}')",
                      c,
                  )
                  c = re.sub(
                      r"fetch\('([^'?]+\.wasm)'\)",
                      lambda m: f"fetch('{m.group(1)}?v={v}')",
                      c,
                  )
                  open(path, 'w').write(c)
              PYEOF
          '';
        };

        default = self.packages.${system}.ft8-lib;
      }
    );

    apps = forAllSystems (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
        webapp = self.packages.${system}.ft8-webapp;
        serve = pkgs.writeShellScript "ft8-serve" ''
          cd "${webapp}"
          exec ${pkgs.python3}/bin/python3 -m http.server --bind 127.0.0.1 8000
        '';
      in {
        default = {
          type = "app";
          program = "${serve}";
        };
      }
    );

    devShells = forAllSystems (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
        zig-env = zig2nix.outputs.zig-env.${system} {
          zig = zig2nix.outputs.packages.${system}.zig-0_17_0;
        };
      in {
        default = zig-env.mkShell {
          nativeBuildInputs = with pkgs; [
            zls
            python3
            wabt
          ];
        };
      }
    );

    formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt-tree);
  };
}
