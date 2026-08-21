# Changelog

## 1.5.0 (2026-08-21)

### Changed

- **The default `source-path-attr` is now `data-tsd-source`**, not `data-source-path`. The old default matched no consumer: `data-tsd-source` is hardcoded in the [TanStack Devtools source inspector](https://tanstack.com/devtools/latest/docs/source-inspector), which is the one tool that reads this attribute off the shelf, so an empty config `{}` now drives it with nothing else set.

  This changes emitted markup for anyone who did not set the option. To keep the old attribute:

  ```jsonc
  ["swc-plugin-jsx-source-attrs", { "source-path-attr": "data-source-path" }]
  ```

  Released as a minor rather than a major: the package has few installs at this point, and the cost of the rename is one line of config against a default that worked with nothing.

  Anything that selects on the attribute has to move with it — CSS, test selectors, `querySelector` calls, and any devtools overlay reading a custom name.

## 1.4.0 (2026-08-20)

### Added

- **`ignore`**, for project source that should stay unannotated — the counterpart to the option of the same name in [@tanstack/devtools-vite](https://tanstack.com/devtools):

  ```jsonc
  {
    "ignore": {
      "files": ["*.test.tsx", "src/generated/**"],
      "components": ["Trans", "*Lazy"]
    }
  }
  ```

  An ignored file gets no attribute at all; an ignored component skips that element only, so its children stay annotated.

  Patterns are globs rather than regexes, which is a real difference from the TanStack option and not an omission: the config reaches the plugin as JSON, and `JSON.stringify(/.*Lazy$/)` is `{}` — a `RegExp` cannot survive the crossing. `*` stays within a path segment, `**` crosses separators, and a `files` pattern without a `/` matches any single segment, as in `.gitignore`. The matcher is ~40 lines rather than the `regex` crate, which would have added several hundred kilobytes to a wasm module every dev build loads; the whole feature costs 11 KB.

- **Next.js on webpack**, checked the same way Turbopack was: against a running app rather than a synthetic filename. `next dev --webpack` and `next build --webpack` on 16.3.1 emit the full `path:line:column`, and server and client agree — so `position: false`, which Turbopack needed before 16.3, is not wanted here.

  The config is the same one Turbopack takes:

  ```ts
  // next.config.ts
  experimental: {
    swcPlugins: [["swc-plugin-jsx-source-attrs", {}]],
  }
  ```

  What differs is the path each bundler reports, because webpack runs the build from the package while Turbopack roots it at the repo — see the `root-dir` fix below, which is what lets one value serve both.

  The combination to avoid is webpack plus `reactCompiler: true`: `turbopackRustReactCompiler` is Turbopack-only and Next.js refuses to start with it under `--webpack`, so the React Compiler there is Babel's, running before the plugin and renumbering the client tree. Measured in [`examples/nextjs`](examples/nextjs): a 26-line client component reported lines 37, 45 and 54 in the client bundle against a real line 17 in the prerendered markup. Set `position: false` for that combination, on any version.

  [`examples/nextjs`](examples/nextjs) now runs under either bundler — `pnpm --filter nextjs dev:webpack` and `build:webpack` alongside the Turbopack scripts.

### Removed

- **`native`**, which emitted `dataSourcePath` because React Native rejects kebab-case props. React Native builds through Metro and Babel, with no SWC in the chain, so the option promised a platform this plugin cannot reach.

  The name it produced is still available as an ordinary value — `{"source-path-attr": "dataSourcePath"}` emits exactly what `native: true` did. A leftover `native` key is ignored rather than rejected, so an unchanged config keeps building; it just gets the default attribute name back.

### Fixed

- **A `root-dir` written for Turbopack dropped every attribute under webpack.** The two bundlers disagree about where a build runs: Turbopack roots the project at the repo, so a monorepo package needs `root-dir: apps/web`, while webpack runs the same build *from* `apps/web` — where that value was joined to the working directory and asked for `/repo/apps/web/apps/web`. No file is under it, so every file counted as outside the project and nothing was annotated at all.

  A relative `root-dir` that names the directory the build is already running in now resolves to that directory. One config, `root-dir: apps/web`, emits `src/components/Button.tsx` under both bundlers.

## 1.3.0 (2026-08-20)

### Fixed

- **`root-dir` still did nothing on Next.js 16.3**, which is what 1.2.0 set out to fix. That release taught the plugin to strip a relative root from Turbopack's `[project]/…` paths — but Next.js does not hand over that shape. It passes the plain `apps/web/src/App.tsx`, which took a different branch: already project-relative, so returned untouched, `root-dir` unread.

  Both shapes are the same thing — a path measured from the project root — and both now take the root the same way. Verified against a running `next dev` on 16.3, not just a synthetic filename.

### Changed

- A **relative** `root-dir` now narrows a relative path from any host, where before such a path was always passed through whole. If yours points at a directory the host's paths are not measured from, files outside it lose the attribute. An absolute `root-dir` is unaffected.
- `path_utils::virtual_root_dir` is now `relative_root_dir`, and `PluginConfig::virtual_root_dir` likewise — the value was never specific to virtual paths. Rust API only; the plugin config is unchanged.

## 1.2.0 (2026-08-20)

### Added

- **`root-dir` now applies under Turbopack**, where it had no effect at all. In a monorepo Turbopack roots the project at the repo, not at the package being built, so a package build reported every file through its workspace prefix — `apps/web/src/Button.tsx` — with no way to shorten it.

  A **relative** `root-dir` is now stripped from a `[project]/…` path as well:

  ```jsonc
  ["swc-plugin-jsx-source-attrs", {"root-dir": "apps/web"}]
  // [project]/apps/web/src/Button.tsx → src/Button.tsx
  ```

  An absolute `root-dir` still cannot apply here: a virtual path never reveals the filesystem location to measure it against. Nor can `../..`, which points above the project root, where no `[project]/…` path can live. Both are ignored under Turbopack, as before.

  The usual consequence of a root follows: a file outside it is not project source and gets **no attribute**. With `root-dir: "apps/web"`, a component imported from `packages/ui` is no longer annotated — its call site in `apps/web` still is, which is the element you want when you click through.

## 1.1.2 (2026-08-20)

### Fixed

- **Hydration mismatch under Turbopack.** The attribute was inserted differently on the server and the client for any element carrying `{...props}`, so React saw two different values for the same node.

  The cause was the rule that skipped an element spreading its enclosing function's props. That rule read the shape of the code — which function owns this element, what its props parameter is called — and Turbopack's client pipeline hands the plugin an already-transformed tree where that shape no longer matches the source. The rule fired on the server and not on the client.

  The attribute is now **inserted first** rather than appended, so a later `{...props}` overwrites it through ordinary JSX evaluation order. A caller's annotation still wins over a wrapper's, which is what the old rule was for, but it now falls out of the emitted code instead of out of an analysis that two pipelines can disagree about.

### Note

`position` still cannot be trusted under Turbopack: the client pipeline reports lines from the transformed tree, which do not exist in your source. Set `position: false` when using Next.js.

## 1.1.1 (2026-08-20)

### Fixed

- **The plugin emitted nothing under Turbopack**, which is the default bundler in Next.js 16. Turbopack does not hand plugins filesystem paths; it addresses modules through a virtual root such as `[project]/src/App.tsx`. The project check added in 1.1.0 measured that against an absolute `root-dir`, matched nothing, and silently skipped every file in the project.

  A `[project]/` path is now taken as already project-relative, as is any plain relative path a host provides. Other virtual roots (`[next]/`, `[externals]/`) are bundler code and stay excluded, and `[project]/node_modules/…` is still treated as a dependency.

## 1.1.0 (2026-08-20)

### Changed

- **Only project files are annotated.** A file is now skipped entirely when it sits outside `root-dir`, or anywhere inside `node_modules` — including pnpm's nested `node_modules/.pnpm/…/node_modules/pkg` layout.

  Previously a file outside `root-dir` fell back to the build machine's absolute path, and a library's own source was annotated with its `node_modules` path. Neither is useful: what you want when you click a library's component is the line in *your* code that rendered it. That call site lives in a project file and is annotated as before, so nothing is lost — the innermost annotated element is now the one you actually wrote.

  If you relied on `data-source-path` appearing inside dependencies, this release removes it.

## 1.0.0 (2026-08-20)

Initial release. Annotates every JSX element with `data-source-path="<file>:<line>:<column>"`, a port of the `injectSource` transform in [@tanstack/devtools](https://tanstack.com/devtools) for SWC-based toolchains.
