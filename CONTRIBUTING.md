# Contributing

Thanks for taking a look. This plugin does one thing — stamp every JSX element with the file, line and column it was written at — so most changes are small and local.

## Setup

You need the Rust toolchain pinned in [rust-toolchain.toml](rust-toolchain.toml) (1.87.0, with the `wasm32-unknown-unknown` target), Node 24, and pnpm.

```bash
pnpm install
```

`rustup` reads `rust-toolchain.toml` and installs the right toolchain and target on first use, so there is nothing to configure by hand.

## The loop

```bash
node --run build
```

Builds the wasm binary into `target/wasm32-unknown-unknown/release/`. The e2e suite loads it from there, so **rebuild after every Rust change** or you will be testing the previous binary — the single easiest mistake to make in this repo.

```bash
cargo test
```

Unit tests and snapshot fixtures. These run natively, not in wasm.

```bash
node --run test:e2e
```

Drives the real `.wasm` through `@swc/core`, which is the only place the plugin runs the way users run it. Anything involving the host — positions, the working directory, the React Compiler — can only be tested here.

```bash
cargo fmt --all
cargo clippy --all-targets -- -D warnings
node --run typecheck
```

CI runs `cargo fmt -- --check`, `cargo clippy -- -D warnings`, `cargo test`, `typecheck`, `build` and `test:e2e`. Warnings are errors, so run clippy before pushing.

## Fixture tests

Each directory under `tests/fixture/` holds an `input.jsx` and the expected `output.jsx`. To regenerate outputs after an intentional change:

```bash
UPDATE=1 cargo test
```

Read the resulting diff before committing it — `UPDATE=1` will happily bake in a regression.

A directory named `dependency_*` is treated as a file the bundler pulled out of `node_modules`; anything else is project source. See the `fixture` function in [tests/test.rs](tests/test.rs).

## Layout

| File | What lives there |
| --- | --- |
| [src/lib.rs](src/lib.rs) | The visitor, the skip rules, and the plugin entry point |
| [src/config.rs](src/config.rs) | The four options and their defaults |
| [src/path_utils.rs](src/path_utils.rs) | Root resolution, and deciding what counts as project source |

## Things that will bite you

**The plugin runs in a wasm sandbox with no filesystem.** Every path question is answered by string manipulation. There is no `canonicalize`, no "does this exist".

**`std::path` compiled for wasm applies POSIX rules**, so it reads the `C:` of a Windows path as an ordinary segment and reports the path as relative. `path_utils` detects roots by hand for that reason — don't "simplify" it back to `std::path`.

**SWC's AST enums gain an extra variant in the wasm build** (`--cfg=swc_ast_unknown`, see [.cargo/config.toml](.cargo/config.toml)). A catch-all `_` arm must be gated with `#[cfg(swc_ast_unknown)]`, or the native build fails with `unreachable pattern` while the wasm build fails without it. Both builds have to pass.

**Positions are unavailable natively.** `lookup_char_pos` is a host call that panics outside wasm, so `JsxSourceAttrsVisitor::new` takes an `Option<Box<dyn SourceMapper>>` and the fixtures pass `None` with `position: false`. Position behaviour belongs in the e2e suite.

**Never resolve a dummy span.** Transforms that ran before this plugin — the React Compiler in particular — can leave elements with no source span. Asking the host to resolve `BytePos(0)` panics with `NoFileFor`, and a wasm plugin cannot catch a panic, so the whole build dies. The guard in `attr_value` is load-bearing.

**`swc_core` is pinned to `=71.0.1`** to match the ABI embedded in `@rspack/core` 2.1.x. A plugin built against a different `swc_core` is rejected at load time by the host, with an error that does not obviously point at the version. Bump it only deliberately.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `chore:`, `docs:`, `test:`. Keep the subject under ~72 characters and use the body to explain *why*, not what the diff already shows.

Each commit should build and pass its tests on its own.
