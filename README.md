# SWC Plugin: JSX Source Attrs

[![npm](https://img.shields.io/npm/v/swc-plugin-jsx-source-attrs)](https://www.npmjs.com/package/swc-plugin-jsx-source-attrs)
[![CI](https://github.com/thedv91/swc-plugin-jsx-source-attrs/actions/workflows/ci.yml/badge.svg)](https://github.com/thedv91/swc-plugin-jsx-source-attrs/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/swc-plugin-jsx-source-attrs)](LICENSE)

An SWC plugin that stamps every JSX element with the file, line and column it was written at.

```jsx
<nav data-tsd-source="src/components/GameModeNav.tsx:3:5">
  <ul data-tsd-source="src/components/GameModeNav.tsx:4:7">
    <li data-tsd-source="src/components/GameModeNav.tsx:5:9">
      <Item data-tsd-source="src/components/GameModeNav.tsx:5:13" />
    </li>
  </ul>
</nav>
```

That is the whole plugin. One attribute, one job: given an element in the browser, tell me the line of source that produced it — the foundation for click-to-source, element inspectors and overlay devtools.

This is a port of the `data-tsd-source` injection in [@tanstack/devtools](https://tanstack.com/devtools), which does the same thing for Vite. If you already build with Vite you do not need this; it exists for toolchains built on SWC (Next.js, Rspack, Nx, plain `@swc/core`) — including as the source of the attribute TanStack's own devtools read, see [TanStack Devtools](#tanstack-devtools).

It ships two ways to do that one job: the **SWC plugin**, and a **loader** for builds that run the React Compiler, which strips the positions out from under any plugin. Same attribute, same options — [which to use](#the-loader--for-builds-with-the-react-compiler).

## Contents

- [Installation](#installation) · [Usage](#usage) · [Compatibility](#compatibility) · [Options](#options)
- [The loader — for builds with the React Compiler](#the-loader--for-builds-with-the-react-compiler)
- [Monorepos](#monorepos) · [Project files only](#project-files-only) · [What else is skipped](#what-else-is-skipped)
- [TanStack Devtools](#tanstack-devtools) — click-to-source under Next.js
- [Known limitation: the React Compiler](#known-limitation-the-react-compiler)

## Installation

```bash
npm install --save-dev swc-plugin-jsx-source-attrs
```

```bash
pnpm add -D swc-plugin-jsx-source-attrs
```

```bash
yarn add -D swc-plugin-jsx-source-attrs
```

## Usage

Every SWC host takes the plugin the same way — a `[name, options]` pair under `jsc.experimental.plugins`. In `.swcrc`, and anywhere else `@swc/core` is driven directly:

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

### Rspack

`builtin:swc-loader` takes the same pair, on whichever rule handles your JSX:

```js
// rspack.config.js
export default {
  module: {
    rules: [
      {
        test: /\.[jt]sx$/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              experimental: {
                plugins: [["swc-plugin-jsx-source-attrs", {}]],
              },
            },
          },
        },
      },
    ],
  },
};
```

Rspack caches compiled wasm plugins under `.swc/` in the project; `jsc.experimental.cacheRoot` moves it.

## The loader — for builds with the React Compiler

If your build runs the **React Compiler**, use the loader instead of the plugin. Same attribute, same options, different point in the pipeline — and it is the only one of the two that can report a position there.

The reason is structural, not a bug to be fixed: an SWC plugin runs *after* the host's own transforms, the React Compiler is one of them, and it rebuilds the JSX tree with no source spans attached. By the time the plugin is asked, the position is already gone — so it emits the bare path (see [the limitation](#known-limitation-the-react-compiler)). The loader runs before any of that, on the source itself, where the position becomes an ordinary string literal that every later transform carries through untouched.

**Turbopack** (`next dev`, `next build --turbopack`):

```ts
// next.config.ts
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.tsx": {
        loaders: [
          {
            loader: "swc-plugin-jsx-source-attrs/loader",
            options: {},
          },
        ],
      },
    },
  },
};
```

**webpack** — same loader, ordinary rule:

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.[jt]sx$/,
        exclude: /node_modules/,
        use: {loader: "swc-plugin-jsx-source-attrs/loader", options: {}},
      },
    ],
  },
};
```

Drop the `swcPlugins` entry when you switch: keeping both is one wasted pass over every file, since the second one to run finds the attribute already there and leaves the element alone.

### What it costs

Measured on a Next.js 16.3 app of ~390 components, `next dev --turbopack` with `reactCompiler: true`, five interleaved rounds, cold compile of one route:

| | cold compile | elements carrying a position |
| --- | --- | --- |
| neither | 5.1–5.5 s | — |
| plugin | 6.4–6.8 s | 2 of 28 |
| loader | 4.4–4.8 s | **28 of 28** |

Warm requests (~95 ms) and HMR rebuilds (~75 ms) were identical in all three. The loader parses each file once more with `@babel/parser` — the only runtime dependency this package has, and only the loader pulls it in — which is cheaper than it sounds next to what SWC then does with the file.

**Either major of `@babel/parser` works**, v7 or v8, and both are tested. v8 is ESM-only and requires Node ^22.18 || >=24.11 — which is also the Node that can `require()` an ES module, so nothing else is needed to use it from this CommonJS loader. On an older runtime, pin `@babel/parser` to `^7`; the loader says so by name rather than failing with `ERR_REQUIRE_ESM`.

The loader also came out *faster than instrumenting nothing at all*, consistently across rounds. That is not explained, and is not a claim to plan around; read the table as "the loader does not cost you anything measurable", not as a speed-up.

### What it does not do

- **Source map columns shift.** Text is spliced in, so every element stays on the line it was written at and line numbers remain exact — but columns after an insertion move by the length of the attribute, and the incoming map is passed through unchanged. Lines are what an editor jumps to; columns are what a stack trace points at.
- **It only sees what the rule matches.** The Turbopack example above covers `*.tsx`; add `*.jsx`, `*.js`, `*.mjs` or `*.cjs` if you write JSX in those. `.ts` is refused even if a rule names it: with the JSX parser plugin on, `<T>(x) => x` reads as an unclosed element rather than a generic arrow. The plugin, sitting inside SWC, sees every module the bundler compiles.

- **A file it cannot parse is passed through.** `errorRecovery` covers what Babel can recover from, but valid syntax needing a plugin the loader does not enable — decorators, most obviously — throws out of the parser. That file goes through unannotated rather than failing the build, which is the bundler's call to make.

- **A `RegExp` in `ignore` is an error, not a no-op.** The plugin never sees one — a config crossing into wasm as JSON has already lost it. The loader is handed the object itself, so a config ported from TanStack Devtools arrives with the regex intact and the loader says so by name. Rewrite them as globs.

## Compatibility

| | |
| --- | --- |
| Host ABI | `swc_core` **71.0.1** — as embedded in `@swc/core` 1.15.43 (what the e2e suite runs) and `@rspack/core` 2.1.x |
| Verified against | Next.js 16.3.1, React 19.2 ([`examples/nextjs`](examples/nextjs)) |
| Output | `wasm32-unknown-unknown`, no runtime dependency |

An SWC wasm plugin is compiled against one `swc_core` ABI and the host rejects any other, so this pin is the one compatibility fact worth checking first. The failure is loud but unhelpful — the host reports that the plugin failed to load, without naming a version — so if the plugin will not start under a bundler that recently updated, compare its `swc_core` against the pin above rather than reading the error.

Next.js is the toolchain checked end to end against a running app; the Rspack config above follows Rspack's documented `builtin:swc-loader` shape and the ABI pin exists to match it, but no example app exercises it here.

## Options

Every option has a default, so `{}` is a working config. Spelled out, that empty object is:

```jsonc
{
  "source-path-attr": "data-tsd-source",
  "position": true,
  "ignore": {
    "files": [],
    "components": []
  }
  // "root-dir" is unset: the working directory is the root
}
```

`root-dir` has no default value to write down — leaving it out means "the directory the build runs in", which is not a string the config can name. Set it only when that directory is not the root you want; see [Monorepos](#monorepos).

[The loader](#the-loader--for-builds-with-the-react-compiler) takes this same object, spelled the same way, so switching between them is a change of wiring and not of config. One difference in how they are read: the loader receives a JavaScript object rather than JSON, and reads each key on its own — so `"position": "false"` leaves that one option wrong (a non-empty string is truthy) instead of discarding the whole config back to the defaults, which is what the plugin does with it.

Options are read independently, so a config only needs the ones it changes. Two ways a config can quietly do nothing, neither of which fails the build: a key the plugin does not know — `sourcePathAttr` instead of `source-path-attr` — is ignored and that option keeps its default, and a known key given the wrong type — `"position": "false"` — discards the *whole* config back to the defaults above. If an option looks like it is being ignored, read the emitted attribute rather than trusting the config.

- **`source-path-attr`** (string, default: `data-tsd-source`): Attribute name to emit. The default is the name the TanStack Devtools source inspector reads, so `{}` works with it unchanged — see [TanStack Devtools](#tanstack-devtools). Set this only for a consumer that reads some other name.

- **`position`** (boolean, default: `true`): Append the element's own `:line:column`. Columns count **characters** from 1 — a tab is one character and a CJK character is one character, which is what an editor asked to jump there counts too, and what keeps the plugin and the loader agreeing on the same element. Set to `false` to emit the file path alone.

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

| Build runs in | `root-dir` | `data-tsd-source` |
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
  //     ^ data-tsd-source="src/App.jsx:4:10"
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

## TanStack Devtools

The devtools' [source inspector](https://tanstack.com/devtools/latest/docs/source-inspector) — hold the hotkey, hover to highlight, click to open the file — is a Vite plugin's feature, but the client half of it is plain DOM code. Point this plugin at the attribute it reads, route the one endpoint it calls, and it works under Next.js — with no route handler and no extra dependency. Verified end to end in [`examples/nextjs`](examples/nextjs) on Next.js 16.3.1 with `@tanstack/react-devtools` 0.10.11.

### Setup

**1.** Install the devtools alongside this plugin:

```bash
npm install --save-dev @tanstack/react-devtools swc-plugin-jsx-source-attrs
```

**2.** `next.config.ts` — the plugin, and a redirect for the endpoint the devtools call on click. No `source-path-attr`: the default is already the `data-tsd-source` the inspector reads.

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    swcPlugins: [
      [
        "swc-plugin-jsx-source-attrs",
        {
          // Only needed when `next dev` does not run from the directory you
          // want paths relative to -- a monorepo package, typically.
          // "root-dir": "apps/web",
        },
      ],
    ],
  },
  async redirects() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/__tsd/open-source",
        permanent: false,
        has: [
          {
            type: "query",
            key: "source",
            value: "(?<file>.+):(?<line>\\d+):(?<column>\\d+)",
          },
        ],
        destination:
          "/__nextjs_launch-editor?file=:file&line1=:line&column1=:column",
      },
      // Positionless fallback -- see "What does not survive" below. Must come
      // second: its pattern also matches a positioned value, first match wins.
      {
        source: "/__tsd/open-source",
        permanent: false,
        has: [{ type: "query", key: "source", value: "(?<file>.+)" }],
        destination: "/__nextjs_launch-editor?file=:file",
      },
    ];
  },
};

export default nextConfig;
```

**3.** `src/components/Devtools.tsx` — a Client Component that only exists in dev:

```tsx
"use client";

import dynamic from "next/dynamic";

const TanStackDevtools =
  process.env.NODE_ENV === "development"
    ? dynamic(
        () => import("@tanstack/react-devtools").then((m) => m.TanStackDevtools),
        { ssr: false },
      )
    : () => null;

export function Devtools() {
  return <TanStackDevtools />;
}
```

**4.** Mount it once in the root layout:

```tsx
// src/app/layout.tsx
import { Devtools } from "@/components/Devtools";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Devtools />
      </body>
    </html>
  );
}
```

**5.** Start `next dev` and check the two halves separately, because both fail silently:

```bash
# the attribute is being emitted
curl -s http://localhost:3000/ | grep -o 'data-tsd-source="[^"]*"' | head -3

# the endpoint resolves -- this opens the file in your editor
curl -sL -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/__tsd/open-source?source=src%2Fapp%2Fpage.tsx%3A1%3A1'
```

The first should print paths like `src/app/page.tsx:8:5`, the second `204`. Then hold **Shift+Alt+Ctrl** (Shift+Alt+Cmd on macOS) and hover: elements outline, with their source path on a label above. Click one and it opens.

Each of those pieces fails differently if it is missing, and none of them fails loudly.

### The attribute name

`data-tsd-source` is hardcoded in the inspector, not configurable on their side — which is why it is this plugin's default. Point `source-path-attr` at any other name and nothing highlights, and the failure reads as a dead hotkey, because the hotkey has no other visible effect. The inspector also does not walk up the tree: it reads the attribute off the topmost element under the cursor and gives up if it is absent, so anything this plugin skips (see [What else is skipped](#what-else-is-skipped)) is a hole in the overlay rather than a hit on its parent.

`root-dir` has to name the directory `next dev` runs in, because a relative path in the attribute is resolved against the project root when the file is opened. Under Turbopack the default root is the repo, so a monorepo package needs this set or the editor is sent to `<cwd>/apps/web/apps/web/…`. See [Monorepos](#monorepos).

### Keeping the devtools out of production

The `NODE_ENV` test in step 3 is the part that matters, not the `dynamic()` call. `@tanstack/react-devtools` carries no production guard of its own — under Vite the plugin's `removeDevtoolsOnBuild` strips it, and nothing does that job here. Imported plainly, it ships: `next build` on [`examples/nextjs`](examples/nextjs) put a 211 KB client chunk in the bundle. Behind the test the import is never reached, and the same build drops from 876 KB of client chunks to 612 KB with no `@tanstack/devtools` code left in `.next` at all.

### Why the endpoint is a redirect

Clicking a highlighted element fetches `/__tsd/open-source?source=path:line:column`, which the Vite plugin answers as dev-server middleware. Next has no equivalent hook, and the client swallows the failure — the fetch is `.catch(() => {})`, so a missing endpoint is indistinguishable from a click that did nothing.

It does not need a route handler of your own, though. Next's dev overlay already runs `/__nextjs_launch-editor`, which does exactly this job; the only mismatch is that TanStack packs the position into one param and Next wants three. The `has` matcher in step 2 splits it with named capture groups, and the whole thing stays in `next.config.ts`.

A **redirect**, not a rewrite. `__nextjs_launch-editor` is served by dev middleware that runs ahead of the router, so a rewritten URL never reaches it — that form returns 404. The 307 makes the browser issue a second, real request, which does; `fetch` follows it without being asked. Next resolves a relative `file` against the project root, so this needs the same `root-dir` as everything else.

The `NODE_ENV` guard keeps it out of the production routes manifest, where it would only ever 404: `__nextjs_launch-editor` is dev-only. Nothing else is added to the app, so there is no route handler to compile into a build, and no `launch-editor` dependency.

If you would rather write the endpoint yourself — to reach an editor Next cannot launch, or to do something other than open a file — an app-router handler plus a `rewrites()` entry works too. Note that `__tsd` cannot be the folder name: Next treats a leading underscore as marking a folder private and opts it out of routing entirely, so the handler has to live elsewhere and be rewritten to.

### The hotkey rejects extra keys

Hold **Shift+Alt+Ctrl** (or Shift+Alt+Cmd). The check is an equality, not a subset — the set of keys held has to match `inspectHotkey` exactly, so a fourth modifier resting under a finger cancels the whole thing silently. Holding all four modifiers leaves the cursor unchanged; releasing one brings the overlay straight back.

`inspectHotkey` and `sourceAction` are configurable on `<TanStackDevtools config={...} />`, but only as the *initial* state — after the first run they live in `localStorage` and change through the Settings tab. Editing the code alone will not move a hotkey that has already been persisted.

### What does not survive

A Client Component compiled by the React Compiler carries the bare path with no `:line:column` — see [the limitation below](#positions-are-lost-with-the-react-compiler). TanStack's own handler drops those requests: its parser requires both numbers and returns nothing without them. The second redirect above is why they still open here, at line 1, which is also what you get from `position: false`.

`sourceAction: "copy-path"` sidesteps the endpoint altogether — the click copies `path:line:column` to the clipboard and never touches the network. Worth knowing if wiring up a route handler is more than the feature is worth to you.

## Known limitation: the React Compiler

Everything below has one root cause. An SWC plugin cannot choose where it sits in the transform chain — it runs *after* the host's own transforms. So it never sees your source; it sees whatever the host has already done to it.

**The way out is [the loader](#the-loader--for-builds-with-the-react-compiler)**, which sits before the chain instead of after it and keeps full positions under the React Compiler. The rest of this section is what happens if you use the plugin there anyway.

### Positions are lost with the React Compiler

With `jsc.transform.reactCompiler` enabled, the attribute is still emitted, but as the bare file path with no `:line:column`.

The React Compiler rebuilds the JSX tree with no source spans attached, so there is nothing left to resolve a position from. The plugin detects this and emits the path alone; without that check the host panics with `NoFileFor(BytePos(0))` and the build dies.

It goes further than the plugin: with the compiler on, even `jsxDEV` receives `void 0` where its `source` argument would go, so React's own devtools lose the location too. Nothing downstream of the compiler can recover a position — which is why the fix has to be upstream of it.

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

| | `data-tsd-source` |
| --- | --- |
| Server Components | full position, e.g. `src/app/page.tsx:7:5` for the `<main>` on line 7 |
| Client Components | bare path, no position — **but identical on server and client**, so nothing mismatches |

Client Components still lose their positions, because the React Compiler rebuilds their tree without spans, as described above. The difference from the Babel pass is that both pipelines now agree, so there is no hydration warning.

Two caveats worth stating plainly. The flag is experimental and Next.js does not recommend it for production. And this was checked by comparing the prerendered markup against the client bundle, not by watching a browser console — the two strings are identical, which is what React compares, but nobody has sat and watched it hydrate.

### Under webpack the compiler is always Babel's

`turbopackRustReactCompiler` is Turbopack-only — Next.js refuses to start with it under `--webpack`, whether you set it to `true` or `false`. So `reactCompiler: true` on a webpack build is the Babel pass no matter which Next.js version you are on, and the client tree comes back renumbered: in `examples/nextjs` a 26-line `ClientPanel.tsx` reported lines 37, 45 and 54 in the client bundle, against a real line 17 in the prerendered markup. Set `position: false` there.

Without the React Compiler, webpack needs no workaround at all — server and client both carry the full `path:line:column`, and they agree. Checked on Next.js 16.3.1 with `next dev --webpack` and `next build --webpack`.

TanStack Devtools sidesteps all of this: as a Vite plugin with `enforce: 'pre'`, it transforms the original source before anything else runs.

## Contributing

Bug reports and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the build loop, the fixture tests, and the handful of wasm-sandbox constraints that make this plugin unusual to work on.

Release notes live in [CHANGELOG.md](CHANGELOG.md).

## Credits

The behaviour is modelled on `injectSource` from [@tanstack/devtools](https://github.com/TanStack/devtools).

## License

[MIT](LICENSE)
