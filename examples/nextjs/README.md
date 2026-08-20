# Next.js example

A scratch app for exercising the plugin in a real toolchain: Next.js 16 with
Turbopack, App Router, React 19.

```bash
pnpm install                # from the repo root
pnpm build                  # cargo build --release --target wasm32-unknown-unknown
pnpm --filter nextjs dev    # http://localhost:3000
```

`next.config.ts` loads the plugin straight out of
`target/wasm32-unknown-unknown/release/`, so the loop after a change to the
Rust source is `pnpm build` at the root, then restart the dev server — SWC
caches the plugin per process, so a hot reload alone will not pick up a new
`.wasm`.

The page on `/` covers one case per section: nested host elements, a fragment,
a component that spreads its props, a hand-written `data-source-path`, and a
component imported from `node_modules`. Open devtools and read the attribute,
or check the prerendered markup without a browser:

```bash
pnpm --filter nextjs build && rg -o 'data-source-path="[^"]*"' examples/nextjs/.next/server/app/index.html | sort -u
```

Expect `<a>` rendered inside `next/link` to carry the position of the `<Link>`
call site in `page.tsx`, and nothing from `next/dist` to be annotated at all.
