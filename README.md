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

### Next.js

```ts
// next.config.ts
const nextConfig: NextConfig = {
  experimental: {
    swcPlugins: [["swc-plugin-jsx-source-attrs", {}]],
  },
};
```

One config, both bundlers: Turbopack and webpack (`next dev --webpack`, `next build --webpack`, and every Next.js version from before Turbopack was the default) both run SWC plugins, and both were checked against a running app in [`examples/nextjs`](examples/nextjs). What differs between them is the path each one reports — see [Monorepos](#monorepos) — and what the React Compiler does to positions, which is the [known limitation](#known-limitation-the-react-compiler) below.

## Options

Every option has a default, so `{}` is a working config. Spelled out, that empty object is:

```jsonc
{
  "source-path-attr": "data-source-path",
  "position": true,
  "ignore": {
    "files": [],
    "components": []
  }
  // "root-dir" is unset: the working directory is the root
}
```

`root-dir` has no default value to write down — leaving it out means "the directory the build runs in", which is not a string the config can name. Set it only when that directory is not the root you want; see [Monorepos](#monorepos).

Options are read independently, so a config only needs the ones it changes. Two ways a config can quietly do nothing, neither of which fails the build: a key the plugin does not know — `sourcePathAttr` instead of `source-path-attr` — is ignored and that option keeps its default, and a known key given the wrong type — `"position": "false"` — discards the *whole* config back to the defaults above. If an option looks like it is being ignored, read the emitted attribute rather than trusting the config.

- **`source-path-attr`** (string, default: `data-source-path`): Attribute name to emit. Use `data-tsd-source` to match TanStack Devtools exactly.

- **`position`** (boolean, default: `true`): Append the element's own `:line:column`. Columns are counted from 1, the way an editor reports them. Set to `false` to emit the file path alone.

- **`ignore`** (object, default: none): Project source to leave alone.

  ```jsonc
  {
    "ignore": {
      "files": ["*.test.tsx", "*.stories.tsx", "src/generated/**"],
      "components": ["Trans", "*Lazy"]
    }
  }
  ```

  `files` is matched against the emitted, project-relative path; a file that matches gets no attribute anywhere in it. `components` is matched against the element name as written — `Button`, `Motion.div`, `svg:rect` — and skips that element only: its children are still annotated, so an ignored wrapper does not blind the whole subtree.

  Patterns are **globs, not regexes**: `*` stays inside one path segment, `**` crosses separators, and a `files` pattern with no `/` in it matches any single segment — so `dist` covers the directory wherever it sits, and `*.test.tsx` covers the file whatever directory it sits in. That is the `.gitignore` rule.

  A `RegExp` is deliberately not accepted, and cannot be: the config crosses into the plugin as JSON, where `JSON.stringify(/.*Lazy$/)` is `{}`. If you are porting a config from TanStack Devtools, rewrite the regexes as globs.

- **`root-dir`** (string, default: the working directory): Directory the emitted path is made relative to.

  Leave it unset and the working directory is the root, so a build run from a package directory emits `src/components/Button.tsx` with no configuration at all.

  A **relative** value is anchored to the working directory. Prefer this over an absolute path: an absolute root is tied to one machine, and on CI or in Docker it silently stops matching, at which point the attribute falls back to the full build-machine path.

  Under **Turbopack** only a relative value has any effect. What the plugin receives there is a path already measured from the project root — `apps/web/src/Button.tsx`, or the virtual `[project]/apps/web/src/Button.tsx`, depending on the host — so `root-dir: apps/web` is stripped from it as you would expect, while an absolute root has no filesystem location to match against and is ignored. So is `../..`, which points above the project root.

  Under **webpack** both forms work, because what arrives there is an ordinary absolute filesystem path. A relative root that names the directory the build is *already running in* is read as that directory rather than joined to it — `root-dir: apps/web` is `/repo/apps/web` whether the build runs at the repo root, as Turbopack sees it, or inside the package, as webpack does. Without that, the same config would ask for `/repo/apps/web/apps/web`, match no file, and silently drop every attribute.

  Windows separators are normalized to `/` on both sides, so the emitted value is identical on every platform. A file **outside** `root-dir` is not project source and gets no attribute at all — see below.

## Monorepos

Which form you get is decided by the working directory the build runs in, not by where the file lives — so set a root explicitly when the two disagree:

| Build runs in | `root-dir` | `data-source-path` |
| --- | --- | --- |
| `apps/web` | *(unset)* | `src/components/Button.tsx:3:5` |
| repo root | *(unset)* | `apps/web/src/components/Button.tsx:3:5` |
| `apps/web` | `../..` | `apps/web/src/components/Button.tsx:3:5` |
| repo root | `apps/web` | `src/components/Button.tsx:3:5` |
| `apps/web` | `apps/web` | `src/components/Button.tsx:3:5` |

Repo-root-relative paths cost a few characters but stay unambiguous: two apps that both have `src/components/Button.tsx` are otherwise indistinguishable.

Under Turbopack the working directory drops out of it entirely — Turbopack roots the project at the repo (that is where the lockfile is), so a package build always reports `apps/web/src/components/Button.tsx` unless you set `root-dir: apps/web`, the one form that reaches a path the host has already made project-relative.

That last row is what makes `root-dir: apps/web` portable: it is the value Turbopack needs, and under webpack — which runs the build from `apps/web` rather than from the repo — it resolves to that same directory instead of being joined below it. Both bundlers then emit `src/components/Button.tsx`, from one config.

Either way, narrowing the root narrows what gets annotated: with `root-dir: apps/web`, a component that lives in `packages/ui` is outside the project and gets nothing. Its call site inside `apps/web` is still annotated, which is the element the browser finds first — the same trade the `node_modules` rule below makes.

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

## Known limitation: the React Compiler

Everything below has one root cause. An SWC plugin cannot choose where it sits in the transform chain — it runs *after* the host's own transforms. So it never sees your source; it sees whatever the host has already done to it.

### Positions are lost with the React Compiler

With `jsc.transform.reactCompiler` enabled, the attribute is still emitted, but as the bare file path with no `:line:column`.

The React Compiler rebuilds the JSX tree with no source spans attached, so there is nothing left to resolve a position from. The plugin detects this and emits the path alone; without that check the host panics with `NoFileFor(BytePos(0))` and the build dies.

### Next.js before 16.3: set `position: false`

```jsonc
['swc-plugin-jsx-source-attrs', { position: false }]
```

With the Babel React Compiler — the only option before 16.3 — the server and client pipelines do not hand the plugin the same tree. The server sees something close to your source; the client sees a tree that has already been through Babel, which runs outside Turbopack in Node. Line numbers taken from the client tree do not exist in your file — a 40-line file reports line 41 — and because the two pipelines disagree, React reports a hydration mismatch on every annotated element.

The file path itself is stable across both, so `position: false` gives you a working attribute. On 16.3 you can keep positions instead — see below.

### Next.js 16.3: the Rust React Compiler fixes it

Next.js 16.3 added [`experimental.turbopackRustReactCompiler`](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackRustReactCompiler), which runs the React Compiler as native code inside Turbopack instead of shelling out to Babel through Node. That removes the pass which was mangling the client tree:

```ts
const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
  },
}
```

Verified on Next.js 16.3.1 in [`examples/nextjs`](examples/nextjs) — positions come back, and are correct:

| | `data-source-path` |
| --- | --- |
| Server Components | full position, e.g. `src/app/page.tsx:7:5` for the `<main>` on line 7 |
| Client Components | bare path, no position — **but identical on server and client**, so nothing mismatches |

Client Components still lose their positions, because the React Compiler rebuilds their tree without spans, as described above. The difference from the Babel pass is that both pipelines now agree, so there is no hydration warning.

Two caveats worth stating plainly. The flag is experimental and Next.js does not recommend it for production. And this was checked by comparing the prerendered markup against the client bundle, not by watching a browser console — the two strings are identical, which is what React compares, but nobody has sat and watched it hydrate.

### Under webpack the compiler is always Babel's

`turbopackRustReactCompiler` is Turbopack-only — Next.js refuses to start with it under `--webpack`, whether you set it to `true` or `false`. So `reactCompiler: true` on a webpack build is the Babel pass no matter which Next.js version you are on, and the client tree comes back renumbered: in `examples/nextjs` a 26-line `ClientPanel.tsx` reported lines 37, 45 and 54 in the client bundle, against a real line 17 in the prerendered markup. Set `position: false` there.

Without the React Compiler, webpack needs no workaround at all — server and client both carry the full `path:line:column`, and they agree. Checked on Next.js 16.3.1 with `next dev --webpack` and `next build --webpack`.

TanStack Devtools sidesteps all of this: as a Vite plugin with `enforce: 'pre'`, it transforms the original source before anything else runs.

## Credits

The behaviour is modelled on `injectSource` from [@tanstack/devtools](https://github.com/TanStack/devtools).
