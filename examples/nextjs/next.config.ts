import type { NextConfig } from "next";

// Point at the freshly built artifact rather than the published
// `swc-plugin-jsx-source-attrs` package, so `cargo build` + restart is the
// whole edit loop -- no `prepack` copy step in between.
// Turbopack resolves this relative to the project root, and rejects an
// absolute path outright ("server relative imports are not implemented yet").
const plugin =
  "../../target/wasm32-unknown-unknown/release/swc_plugin_jsx_source_attrs.wasm";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
    // No `root-dir`: Turbopack runs from the workspace root it detects (the
    // repo root here, not this directory), so paths come out as
    // `examples/nextjs/src/app/page.tsx`. Set `root-dir: "examples/nextjs"` to
    // get plain `src/app/page.tsx` instead.
    swcPlugins: [[plugin, {}]],
  },
};

export default nextConfig;
