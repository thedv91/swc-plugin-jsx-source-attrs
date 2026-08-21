# Next.js example

A scratch app for exercising the plugin in a real toolchain: Next.js 16, App
Router, React 19 — under Turbopack and under webpack.

```bash
pnpm install                        # from the repo root
pnpm build                          # cargo build --release --target wasm32-unknown-unknown
pnpm --filter nextjs dev            # Turbopack, http://localhost:3000
pnpm --filter nextjs dev:webpack    # webpack, same port
```

`next.config.ts` reads `process.env.TURBOPACK` to tell the two apart, because
the `--webpack` flag itself never reaches it: `next dev` reloads the config in a
child process and `next build` in workers, and neither is passed that argument.
The React Compiler is enabled only under Turbopack, where 16.3 can run it as
native code — the Babel one webpack would use renumbers the client tree.

`next.config.ts` loads the plugin straight out of
`target/wasm32-unknown-unknown/release/`, so the loop after a change to the
Rust source is `pnpm build` at the root, then restart the dev server — SWC
caches the plugin per process, so a hot reload alone will not pick up a new
`.wasm`.

The page on `/` covers one case per section: nested host elements, a fragment,
a component that spreads its props, a hand-written `data-tsd-source`, and a
component imported from `node_modules`. Open devtools and read the attribute,
or check the prerendered markup without a browser:

```bash
pnpm --filter nextjs build && rg -o 'data-tsd-source="[^"]*"' examples/nextjs/.next/server/app/index.html | sort -u
```

Swap in `build:webpack` for the same check under webpack. The paths differ
between the two: Turbopack roots the project at the repo and reports
`examples/nextjs/src/app/page.tsx`, webpack runs from this directory and reports
`src/app/page.tsx`. Setting `root-dir: "examples/nextjs"` in `next.config.ts`
gives the shorter form under both.

Expect `<a>` rendered inside `next/link` to carry the position of the `<Link>`
call site in `page.tsx`, and nothing from `next/dist` to be annotated at all.
