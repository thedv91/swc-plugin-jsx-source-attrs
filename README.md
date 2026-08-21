# SWC Plugin: JSX Source Attrs

[![npm](https://img.shields.io/npm/v/swc-plugin-jsx-source-attrs)](https://www.npmjs.com/package/swc-plugin-jsx-source-attrs)
[![CI](https://github.com/thedv91/swc-plugin-jsx-source-attrs/actions/workflows/ci.yml/badge.svg)](https://github.com/thedv91/swc-plugin-jsx-source-attrs/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/swc-plugin-jsx-source-attrs)](LICENSE)

Stamps every JSX element with the file, line and column it was written at.

```jsx
<nav data-tsd-source="src/components/nav.tsx:3:5">
  <ul data-tsd-source="src/components/nav.tsx:4:7">
    <li data-tsd-source="src/components/nav.tsx:5:9">
      <span data-tsd-source="src/components/nav.tsx:6:13" />
    </li>
  </ul>
</nav>
```

One attribute, one job: given an element in the browser, tell me the line of source that produced it — the data layer under click-to-source, element inspectors and overlay devtools. A port of the `injectSource` transform in [@tanstack/devtools](https://tanstack.com/devtools), which does this for Vite, to toolchains built on SWC.

It ships two ways to do it. **Use the loader if your build runs the React Compiler**, the plugin otherwise:

| | runs | positions under React Compiler |
| --- | --- | --- |
| **SWC plugin** | inside SWC, after the host's transforms | lost — [why](#the-react-compiler) |
| **Loader** | before the pipeline, on your source | kept |

- [Install](#install) · [Plugin](#plugin) · [Loader](#loader) · [Options](#options)
- [What is skipped](#what-is-skipped) · [Monorepos](#monorepos) · [The React Compiler](#the-react-compiler)
- [TanStack Devtools](#tanstack-devtools) — click-to-source under Next.js
- [Compatibility](#compatibility)

## Install

```bash
npm install --save-dev swc-plugin-jsx-source-attrs
```

This is a development tool: it puts an attribute on every element and inflates the output. Wire it into the config your dev build uses and keep it out of production — the plugin has no opinion about which build it is in, while the [loader's config builders](#loader) default to `next dev` only.

## Plugin

Every SWC host takes it the same way, as a `[name, options]` pair. `{}` is a working config.

**Next.js** — one config for both bundlers, Turbopack and `--webpack`:

```ts
// next.config.ts
const nextConfig: NextConfig = {
  experimental: {
    swcPlugins: [["swc-plugin-jsx-source-attrs", {}]],
  },
};
```

**`.swcrc`**, and anywhere `@swc/core` is driven directly:

```json
{
  "jsc": {
    "experimental": {
      "plugins": [["swc-plugin-jsx-source-attrs", {}]]
    }
  }
}
```

**Rspack** — `builtin:swc-loader`, on whichever rule handles your JSX:

```js
{
  test: /\.[jt]sx$/,
  use: {
    loader: "builtin:swc-loader",
    options: {jsc: {experimental: {plugins: [["swc-plugin-jsx-source-attrs", {}]]}}},
  },
}
```

Rspack caches compiled wasm plugins under `.swc/`; `jsc.experimental.cacheRoot` moves it.

## Loader

Same attribute, same [options](#options), inserted into the source before the bundler's pipeline runs — the only place a position survives the [React Compiler](#the-react-compiler).

```ts
// next.config.ts
import {turbopackRules} from "swc-plugin-jsx-source-attrs/config";

const nextConfig: NextConfig = {
  turbopack: {rules: turbopackRules()},
};
```

On Next.js 15 and earlier the same object goes under `experimental.turbo.rules`. Rules of your own spread alongside:

```ts
rules: {
  ...turbopackRules({ignore: {files: ["*.test.tsx"]}}),
  "*.svg": {loaders: ["@svgr/webpack"], as: "*.js"},
}
```

For webpack (and Rspack, same shape), `webpackRule()` returns a `module.rules` entry with `test` and `exclude` already set:

```js
const {webpackRule} = require("swc-plugin-jsx-source-attrs/config");

module.exports = {module: {rules: [webpackRule()]}};
```

Both builders take every [option](#options) the plugin takes, plus:

- **`enabled`** (default: `process.env.NODE_ENV === "development"`, read when the builder is called). Disabled, `turbopackRules()` returns `{}` and `webpackRule()` returns a rule matching no filename — a production build carries nothing unless you ask: `turbopackRules({enabled: process.env.INSPECT === "1"})`.
- **`extensions`** (Turbopack, default `["jsx", "tsx"]`) and **`test`** (webpack), to change what the rule matches.

Neither merges anything into your config; they return the rule and nothing else. `loaderPath` is exported for a rule you would rather write by hand.

### What it costs

Next.js 16.3 app of ~390 components, `next dev --turbopack` with `reactCompiler: true`, five interleaved rounds, cold compile of one route:

| | cold compile | elements carrying a position |
| --- | --- | --- |
| neither | 5.1–5.5 s | — |
| plugin | 6.4–6.8 s | 2 of 28 |
| loader | 4.4–4.8 s | **28 of 28** |

Warm requests (~95 ms) and HMR rebuilds (~75 ms) were identical in all three. The loader also came out faster than instrumenting nothing at all, consistently across rounds — unexplained, and not a claim to plan around; read the table as "costs nothing measurable".

### Limits

- **Source map columns shift.** Text is spliced in, so lines stay exact and only columns after an insertion move; the incoming map is passed through unchanged.
- **`.ts` is refused** whatever the rule says — with the JSX parser on, `<T>(x) => x` reads as an unclosed element rather than a generic arrow. `.js`, `.mjs` and `.cjs` are fine; name them in `extensions`.
- **A file it cannot parse goes through unannotated.** Valid syntax needing a parser plugin the loader does not enable — decorators, most obviously — throws, and failing a build over one attribute is the bundler's call to make, not this one's.
- **A `RegExp` in `ignore` is a `TypeError`, not a no-op.** The plugin never sees one (JSON drops it); the loader is handed the object itself, so it rejects it by name. Rewrite them as globs.

## Options

Every option has a default, so `{}` works. Spelled out:

```jsonc
{
  "source-path-attr": "data-tsd-source",
  "position": true,
  "ignore": {"files": [], "components": []}
  // "root-dir" unset: the directory the build runs in
}
```

- **`source-path-attr`** (default `data-tsd-source`) — the name the TanStack Devtools inspector hardcodes, which is why it is the default. Change it only for a consumer reading another name.

- **`position`** (default `true`) — append `:line:column`. Columns count **characters** from 1, not display width: a tab is one character and so is a CJK character. That is what an editor counts, and what keeps plugin and loader agreeing on the same element. `false` emits the path alone.

- **`ignore.files`** / **`ignore.components`** — globs, not regexes. `*` stays inside a path segment, `**` crosses separators, and a `files` pattern with no `/` matches any single segment, as in `.gitignore`. `files` is matched against the emitted project-relative path and skips the whole file; `components` is matched against the name as written (`Button`, `Motion.div`, `svg:rect`) and skips that element only, leaving its children annotated.

  ```jsonc
  {"ignore": {"files": ["*.test.tsx", "src/generated/**"], "components": ["Trans", "*Lazy"]}}
  ```

- **`root-dir`** (default: the directory the build runs in) — what the emitted path is measured against. Prefer a relative value: an absolute one is tied to one machine and silently stops matching on CI. A file outside it is not project source and gets nothing. See [Monorepos](#monorepos).

Options are read independently. Two ways a config can quietly do nothing: an unknown key (`sourcePathAttr` for `source-path-attr`) is ignored, and — for the plugin only — a known key with the wrong type discards the *whole* config back to defaults. If an option looks ignored, read the emitted attribute rather than trusting the config.

## What is skipped

- **`node_modules`, however deep**, and anything outside `root-dir`. Not a size optimisation: the point is that clicking a library's button lands on the line in *your* code that rendered it, and that call site is a project file, annotated normally.
- **Fragments** — `<>`, `<Fragment>` and `<React.Fragment>` emit no host node. Their children are still annotated.
- **Elements that already carry the attribute** — written by hand, or by an earlier pass over the same file.
- **Elements a `{...props}` overwrites.** The attribute is inserted *first*, so a later spread wins by ordinary JSX evaluation order and the caller's position is what reaches the DOM. Nothing inspects the code to decide that.

## Monorepos

Which form you get is decided by the directory the build runs in, not by where the file lives:

| Build runs in | `root-dir` | `data-tsd-source` |
| --- | --- | --- |
| `apps/web` | *(unset)* | `src/components/Button.tsx:3:5` |
| repo root | *(unset)* | `apps/web/src/components/Button.tsx:3:5` |
| `apps/web` | `../..` | `apps/web/src/components/Button.tsx:3:5` |
| repo root | `apps/web` | `src/components/Button.tsx:3:5` |
| `apps/web` | `apps/web` | `src/components/Button.tsx:3:5` |

That last row is what makes `root-dir: apps/web` portable. Turbopack roots the project at the repo (that is where the lockfile is) and needs exactly that value; webpack runs the same build *from* `apps/web`, where a relative root naming the directory you are already in is read as that directory rather than joined below it. One config, `src/components/Button.tsx` under both.

Under Turbopack only a relative value has any effect: what arrives there is already measured from the project root, so an absolute root has no filesystem location to match against — and `../..` points above the project.

## The React Compiler

**With `reactCompiler` on, the plugin cannot report positions. Use [the loader](#loader).**

An SWC plugin runs *after* the host's transforms and the compiler is one of them: it rebuilds the JSX tree with no source spans, so by the time the plugin is asked there is nothing left to resolve. It emits the bare path — without that check the host panics with `NoFileFor(BytePos(0))` and the build dies. Nothing downstream can recover the position; with the compiler on, even `jsxDEV` receives `void 0` where its `source` argument goes, so React's own devtools lose the location too.

Measured on one app: 346 of 389 files lost every position. Server Components keep theirs — that pipeline does not hand the plugin a compiled tree.

Two more combinations, both plugin-only:

- **Next.js before 16.3** — the compiler is Babel's, and the server and client pipelines disagree. The client tree comes back renumbered (a 40-line file reporting line 41), which React then reports as a hydration mismatch on every annotated element. Set `position: false`; the path itself is stable across both.
- **Under `--webpack`, on any version** — `turbopackRustReactCompiler` is Turbopack-only and Next refuses to start with it there, so `reactCompiler: true` is the Babel pass again. In [`examples/nextjs`](examples/nextjs) a client component reported lines 37, 45 and 54 against a real line 17. Set `position: false`.

Without the React Compiler, webpack needs no workaround at all — server and client both carry the full position and agree.

## TanStack Devtools

The devtools' [source inspector](https://tanstack.com/devtools/latest/docs/source-inspector) — hold the hotkey, hover to highlight, click to open the file — is a Vite plugin's feature, but its client half is plain DOM code. Feed it this attribute, point its one request at the dev overlay's editor endpoint, and it works under Next.js with no route handler and no extra dependency. Verified end to end in [`examples/nextjs`](examples/nextjs) on Next.js 16.3.1 with `@tanstack/react-devtools` 0.10.11.

**1.** Wire the attribute in — [plugin](#plugin) or [loader](#loader), no `source-path-attr` needed since the default is the name the inspector reads.

**2.** Route the endpoint in `next.config.ts`. Needed only if the devtools' own click handler is the one calling out — the blocker [below](#taking-the-click-over) calls `__nextjs_launch-editor` itself and never touches this path:

```ts
async redirects() {
  if (process.env.NODE_ENV !== "development") return [];
  return [
    {
      source: "/__tsd/open-source",
      permanent: false,
      has: [{type: "query", key: "source", value: "(?<file>.+):(?<line>\\d+):(?<column>\\d+)"}],
      destination: "/__nextjs_launch-editor?file=:file&line1=:line&column1=:column",
    },
    // Positionless fallback, for `position: false` and for anything the React
    // Compiler flattened. Must come second: its pattern also matches a
    // positioned value, and the first match wins.
    {
      source: "/__tsd/open-source",
      permanent: false,
      has: [{type: "query", key: "source", value: "(?<file>.+)"}],
      destination: "/__nextjs_launch-editor?file=:file",
    },
  ];
}
```

**3.** Mount the panel from a Client Component that only exists in dev. The `NODE_ENV` test is the part that matters, not `dynamic()`: `@tanstack/react-devtools` has no production guard of its own, and imported plainly it ships — 211 KB of client chunks in `examples/nextjs`.

```tsx
"use client";
import dynamic from "next/dynamic";

const TanStackDevtools =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("@tanstack/react-devtools").then((m) => m.TanStackDevtools), {ssr: false})
    : () => null;

export function Devtools() {
  return <TanStackDevtools />;
}
```

**4.** Check the two halves separately, because both fail silently:

```bash
curl -s http://localhost:3000/ | grep -o 'data-tsd-source="[^"]*"' | head -3
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/__nextjs_launch-editor?file=src%2Fapp%2Fpage.tsx&line1=1&column1=1'
# only with the redirects from step 2:
curl -sL -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/__tsd/open-source?source=src%2Fapp%2Fpage.tsx%3A1%3A1'
```

Paths like `src/app/page.tsx:8:5`, then `204`. Now hold **Shift+Alt+Ctrl** (Shift+Alt+Cmd on macOS), hover, and click.

The status code names the failure: **400** no `file` param · **404** the path resolved against the project directory does not exist, so check `root-dir` · **500** the editor spawn threw · **204** Next called the editor. Only `file` is required — `line1` and `column1` go through `parseInt(… ?? "0") || undefined`, so absent, `0` and garbage alike just open the file at line 1. Note that 204 does not promise a window actually appeared: `launchEditor` spawns asynchronously, and a child that dies is not reported back.

Everything here fails quietly, so the six things that actually go wrong:

- **The hotkey is an equality, not a subset.** A fourth modifier resting under a finger cancels it with no visible effect at all. `inspectHotkey` is configurable on `<TanStackDevtools config={...} />`, but only as *initial* state — after the first run it lives in `localStorage` and moves through the Settings tab.
- **The attribute name is hardcoded** in the inspector. Point `source-path-attr` elsewhere and nothing highlights, which reads as a dead hotkey.
- **The inspector does not walk up the tree.** It reads the attribute off the topmost element under the cursor and gives up if it is absent, so anything [skipped](#what-is-skipped) is a hole in the overlay rather than a hit on its parent.
- **`root-dir` has to name the directory `next dev` runs in.** A relative `file` is resolved against the project directory when it is opened, so a mismatch is the 404 above — on either route.
- **If you do route through `/__tsd/open-source`, it has to be a redirect, not a rewrite.** `__nextjs_launch-editor` is served by dev middleware that runs ahead of the router, so a rewritten URL never reaches it and 404s. The 307 makes the browser issue a second, real request; `fetch` follows it unasked.
- **The inspect click reaches the app too — and inside a modal it reaches nothing else.** See below; this one costs about forty lines to fix.

`sourceAction: "copy-path"` sidesteps the endpoint entirely — the click copies `path:line:column` to the clipboard and never touches the network.

### Taking the click over

The inspector listens on `document` in the **bubble** phase. Two things follow, and the second is the one that looks like a broken build:

- React has already dispatched `onClick` by then, so inspecting a `<button>` fires its handler and inspecting a `<Link>` navigates, on the way to opening the file. Their `preventDefault()` only cancels the browser's default action.
- Anything that stops propagation on the way up eats the click entirely. That is every portal modal that guards against click-outside — measured in [`examples/nextjs`](examples/nextjs) with real mouse and key input:

  | modal content | click capture (document) | click bubble (document) | request sent |
  | --- | --- | --- | --- |
  | `onClick={(e) => e.stopPropagation()}` | runs | **never runs** | none |
  | no `stopPropagation` | runs | runs | opens the file, and closes the modal |

Claiming the click in the capture phase stops React, but it also stops the event before the inspector's own listener sees it — verified, the file no longer opens. So take the click over completely and repeat the one thing that handler does:

```tsx
import {useEffect} from "react";

const DEFAULT_INSPECT_HOTKEY = ["Shift", "Alt", "CtrlOrMeta"];

// Whatever the Settings tab last wrote. Read per click, not cached: the panel
// writes this key on every edit, with no reload in between.
function inspectHotkey(): Array<string> {
  try {
    const settings = localStorage.getItem("tanstack_devtools_settings");
    const keys = settings ? JSON.parse(settings).inspectHotkey : null;
    return Array.isArray(keys) && keys.length > 0 ? keys : DEFAULT_INSPECT_HOTKEY;
  } catch {
    return DEFAULT_INSPECT_HOTKEY;
  }
}

// Held keys are tracked from key events rather than read off the click, because
// the modifier flags on a synthesized click carry none of this. The comparison
// mirrors the devtools': every key in the combo, and nothing beyond it.
function isInspecting(held: Set<string>) {
  const pressed = new Set([...held].map((key) => key.toUpperCase()));
  return ["CONTROL", "META"].some((either) => {
    const combo = inspectHotkey().map((key) => (key === "CtrlOrMeta" ? either : key.toUpperCase()));
    return combo.length === pressed.size && combo.every((key) => pressed.has(key));
  });
}

export function useBlockInspectClicks() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const held = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => held.add(e.key);
    const onKeyUp = (e: KeyboardEvent) => held.delete(e.key);
    // Modifiers released while the tab is unfocused never emit a keyup, which
    // would leave this armed against ordinary clicks.
    const onBlur = () => held.clear();

    const onClick = (e: MouseEvent) => {
      if (!isInspecting(held)) return;

      // `elementFromPoint`, no ancestor walk — the same way the inspector reads
      // it, so what opens is what was highlighted.
      const source = document.elementFromPoint(e.clientX, e.clientY)?.getAttribute("data-tsd-source");

      e.preventDefault();
      e.stopPropagation();

      if (!source) return;
      // Straight to the dev overlay: it reads the position as separate params
      // and answers 400 to the packed one, so the split happens here. The
      // positionless branch is live, not a guard — a Client Component under the
      // React Compiler emits the bare path.
      const at = /^(.*):(\d+):(\d+)$/.exec(source);
      const params = at
        ? new URLSearchParams({file: at[1], line1: at[2], column1: at[3]})
        : new URLSearchParams({file: source});
      fetch(`/__nextjs_launch-editor?${params}`).catch(() => {});
    };

    addEventListener("keydown", onKeyDown, {capture: true});
    addEventListener("keyup", onKeyUp, {capture: true});
    addEventListener("blur", onBlur);
    document.addEventListener("click", onClick, {capture: true});

    return () => {
      removeEventListener("keydown", onKeyDown, {capture: true});
      removeEventListener("keyup", onKeyUp, {capture: true});
      removeEventListener("blur", onBlur);
      document.removeEventListener("click", onClick, {capture: true});
    };
  }, []);
}
```

Call it from the same component that mounts the panel. Two things worth knowing before you paste it:

- **It swallows every click that matches the hotkey**, so a one-key `inspectHotkey` of `CtrlOrMeta` also swallows Cmd+click to open a link in a new tab. `Alt` collides with less.
- **It reads devtools internals** — the `localStorage` key, the attribute name, the endpoint — none of which are a public contract. It exists only because the listener is on the bubble phase; if that ever moves to capture upstream, delete the whole thing.

## Compatibility

| | |
| --- | --- |
| Host ABI | `swc_core` **71.0.1** — as embedded in `@swc/core` 1.15.43 (what the e2e suite runs) and `@rspack/core` 2.1.x |
| Verified against | Next.js 16.3.1, React 19.2 ([`examples/nextjs`](examples/nextjs)) |
| Plugin output | `wasm32-unknown-unknown`, nothing else at runtime |
| Loader | CommonJS; the package's one dependency, `@babel/parser` v7 or v8. v8 is ESM-only and wants Node `^22.18 \|\| >=24.11` — on anything older, pin `^7` |

A wasm plugin is compiled against one `swc_core` ABI and the host rejects any other. The failure is loud but unhelpful — the host says the plugin failed to load, without naming a version — so if it will not start under a bundler that recently updated, compare its `swc_core` against the pin above rather than reading the error.

Next.js is the toolchain checked end to end against a running app. The Rspack config follows Rspack's documented `builtin:swc-loader` shape and the ABI pin exists to match it, but no example app exercises it here.

## Contributing

Bug reports and pull requests welcome — [CONTRIBUTING.md](CONTRIBUTING.md) covers the build loop, the fixture tests, and the wasm-sandbox constraints that make this plugin unusual to work on. Release notes live in [CHANGELOG.md](CHANGELOG.md).

Behaviour modelled on `injectSource` from [@tanstack/devtools](https://github.com/TanStack/devtools).

## License

[MIT](LICENSE)
