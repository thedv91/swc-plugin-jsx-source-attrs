import type { NextConfig } from "next";

// Point at the freshly built artifact rather than the published
// `swc-plugin-jsx-source-attrs` package, so `cargo build` + restart is the
// whole edit loop -- no `prepack` copy step in between.
// Turbopack resolves this relative to the project root, and rejects an
// absolute path outright ("server relative imports are not implemented yet").
const plugin =
  "../../target/wasm32-unknown-unknown/release/swc_plugin_jsx_source_attrs.wasm";

// Which bundler is running is not on `NextConfig`, and the `--webpack` flag
// cannot be read back: `next dev` reloads this file in a child process, and
// `next build` in workers, neither of which is given that argument. Turbopack
// exports `TURBOPACK` into all of them, and webpack leaves it unset -- that is
// the only signal that survives.
const webpack = !process.env.TURBOPACK;

const nextConfig: NextConfig = {
  // Only Turbopack can run the React Compiler as native code. Under webpack it
  // is Babel's, which runs before the plugin and renumbers the client tree, so
  // positions there would have to be given up -- see "The React Compiler" in
  // the root README.
  reactCompiler: !webpack,
  experimental: {
    // Next rejects this flag under webpack whether it is true or false, so it
    // has to be absent there rather than disabled.
    ...(webpack ? {} : { turbopackRustReactCompiler: true }),
    // No `root-dir`, which is also why the two bundlers report different paths
    // here: Turbopack runs from the workspace root it detects (the repo root,
    // not this directory) and reports `examples/nextjs/src/app/page.tsx`, while
    // webpack runs from this directory and reports `src/app/page.tsx`. Setting
    // `root-dir: "examples/nextjs"` gives the shorter form under both.
    swcPlugins: [[plugin, {}]],
  },
};

export default nextConfig;
