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
    // `data-tsd-source` is the name the TanStack Devtools source inspector
    // reads; it is hardcoded there, not configurable on their side.
    // `root-dir` has to name the directory the dev server runs in: the open-source
    // handler resolves the attribute against `process.cwd()`, so anything else
    // (Turbopack's default here is the repo root) sends the editor to a path that
    // does not exist.
    swcPlugins: [
      [
        plugin,
        { "source-path-attr": "data-tsd-source", "root-dir": "examples/nextjs" },
      ],
    ],
  },
  // The devtools client fetches `/__tsd/open-source?source=path:line:column` on
  // click. Nothing serves that under Next -- but the dev overlay's own
  // `__nextjs_launch-editor` does exactly the same job, so split the one packed
  // param into the three it expects and hand it over. Keeps the app free of a
  // route handler, which would otherwise be compiled into production builds.
  //
  // A redirect, not a rewrite: `__nextjs_launch-editor` is served by dev
  // middleware that runs ahead of the router, so a rewritten URL never reaches
  // it (verified -- the rewrite form 404s). The 307 makes the browser issue a
  // second, real request, which does. `fetch` follows it by default.
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
      // Positionless fallback, for `position: false` and for Client Components
      // under the React Compiler -- both emit the bare path. Must come second:
      // its pattern also matches a positioned value, and the first match wins.
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
