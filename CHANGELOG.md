# Changelog

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
