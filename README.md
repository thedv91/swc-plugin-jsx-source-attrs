# SWC Plugin: JSX Source Attrs [![npm badge](https://img.shields.io/npm/v/swc-plugin-jsx-source-attrs)](https://www.npmjs.com/package/swc-plugin-jsx-source-attrs)

An SWC plugin that stamps every JSX element with the file, line and column it was written at.

```jsx
<nav data-source-path="src/components/GameModeNav.tsx:3:5">
  <ul data-source-path="src/components/GameModeNav.tsx:4:7">
    <li data-source-path="src/components/GameModeNav.tsx:5:9">
      <Item data-source-path="src/components/GameModeNav.tsx:5:13" />
    </li>
  </ul>
</nav>
```

That is the whole plugin. One attribute, one job: given an element in the browser, tell me the line of source that produced it — the foundation for click-to-source, element inspectors and overlay devtools.

This is a port of the `data-tsd-source` injection in [@tanstack/devtools](https://tanstack.com/devtools), which does the same thing for Vite. If you already use TanStack Devtools you do not need this; it exists for toolchains built on SWC (Next.js, Rspack, Nx, plain `@swc/core`).

## Installation

```bash
npm install --save-dev swc-plugin-jsx-source-attrs
```

## Usage

```json
{
  "jsc": {
    "experimental": {
      "plugins": [
        ["swc-plugin-jsx-source-attrs", {}]
      ]
    }
  }
}
```

This is a development tool. It puts an attribute on every element and inflates the output, so wire it into the config your dev build uses and leave it out of production.

## Options

- **`source-path-attr`** (string, default: `data-source-path`): Attribute name to emit. Use `data-tsd-source` to match TanStack Devtools exactly.

- **`position`** (boolean, default: `true`): Append the element's own `:line:column`. Columns are counted from 1, the way an editor reports them. Set to `false` to emit the file path alone.

- **`native`** (boolean, default: `false`): Emit `dataSourcePath` instead — React Native rejects kebab-case props. An explicit `source-path-attr` wins over this.

- **`root-dir`** (string, default: the working directory): Directory the emitted path is made relative to.

  Leave it unset and the working directory is the root, so a build run from a package directory emits `src/components/Button.tsx` with no configuration at all.

  A **relative** value is anchored to the working directory. Prefer this over an absolute path: an absolute root is tied to one machine, and on CI or in Docker it silently stops matching, at which point the attribute falls back to the full build-machine path.

  Windows separators are normalized to `/` on both sides, so the emitted value is identical on every platform. A file **outside** `root-dir` is not project source and gets no attribute at all — see below.

## Monorepos

Which form you get is decided by the working directory the build runs in, not by where the file lives — so set a root explicitly when the two disagree:

| Build runs in | `root-dir` | `data-source-path` |
| --- | --- | --- |
| `apps/web` | *(unset)* | `src/components/Button.tsx:3:5` |
| repo root | *(unset)* | `apps/web/src/components/Button.tsx:3:5` |
| `apps/web` | `../..` | `apps/web/src/components/Button.tsx:3:5` |
| repo root | `apps/web` | `src/components/Button.tsx:3:5` |

Repo-root-relative paths cost a few characters but stay unambiguous: two apps that both have `src/components/Button.tsx` are otherwise indistinguishable.

## Project files only

Only your own source is annotated. A file is skipped entirely when it sits **outside `root-dir`**, or **inside `node_modules`** — however deep, so pnpm's `node_modules/.pnpm/…/node_modules/pkg` layout is covered too.

This is not a size optimisation, it is the point of the attribute. What you want when you click a library's button is the line in *your* code that rendered it, not a line in `dist/index.js` you cannot edit — and you get exactly that, because the call site lives in a project file:

```jsx
// src/App.jsx — annotated normally
import {Button} from "some-lib";

function App() {
  return <Button label="hi" />;
  //     ^ data-source-path="src/App.jsx:4:10"
}
```

```jsx
// node_modules/some-lib/dist/index.js — untouched
export function Button(props) {
  return <button className="lib-button" {...props} />;
}
```

The library's internal `<button>` gets nothing, so the innermost annotated element the browser can find is the one you wrote.

## What else is skipped

- **Fragments** — `<>`, `<Fragment>` and `<React.Fragment>` emit no host node, so there is nothing to hang an attribute on. Their children are still annotated.
- **Elements that spread the enclosing props** — `function Wrapper(props) { return <div {...props} /> }`. The spread already forwards whatever the caller annotated; appending here would overwrite the caller's real position with the wrapper's.
- **Elements that already have the attribute** — written by hand, or by an earlier pass over the same file.

## Known limitation: React Compiler

With `jsc.transform.reactCompiler` enabled, **positions are lost** — the attribute is still emitted, but as the bare file path with no `:line:column`.

SWC runs experimental plugins after its own transforms, and the React Compiler rebuilds the JSX tree with no source spans attached. There is nothing left to resolve a position from. The plugin detects this and emits the path alone; without that check the host panics with `NoFileFor(BytePos(0))` and the build dies.

TanStack Devtools is unaffected because it transforms the original source before any of this happens.

## Credits

The behaviour is modelled on `injectSource` from [@tanstack/devtools](https://github.com/TanStack/devtools).
