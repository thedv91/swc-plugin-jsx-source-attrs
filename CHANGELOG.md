# Changelog

## 1.1.0 (2026-08-20)

### Changed

- **Only project files are annotated.** A file is now skipped entirely when it sits outside `root-dir`, or anywhere inside `node_modules` — including pnpm's nested `node_modules/.pnpm/…/node_modules/pkg` layout.

  Previously a file outside `root-dir` fell back to the build machine's absolute path, and a library's own source was annotated with its `node_modules` path. Neither is useful: what you want when you click a library's component is the line in *your* code that rendered it. That call site lives in a project file and is annotated as before, so nothing is lost — the innermost annotated element is now the one you actually wrote.

  If you relied on `data-source-path` appearing inside dependencies, this release removes it.

## 1.0.0 (2026-08-20)

Initial release. Annotates every JSX element with `data-source-path="<file>:<line>:<column>"`, a port of the `injectSource` transform in [@tanstack/devtools](https://tanstack.com/devtools) for SWC-based toolchains.
