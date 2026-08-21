import path from "node:path";
import { transformSync, type Options } from "@swc/core";

export type PluginConfig = Record<string, unknown>;

const pluginPath = path.resolve(
  "target/wasm32-unknown-unknown/release/swc_plugin_jsx_source_attrs.wasm",
);

/** Run source through @swc/core with the plugin wired in. */
export function transform(
  source: string,
  pluginConfig: PluginConfig = {},
  swcOptions: Pick<Options, "isModule" | "jsc" | "filename"> = {},
): string {
  const jsc: NonNullable<Options["jsc"]> = {
    parser: { syntax: "ecmascript", jsx: true },
    experimental: { plugins: [[pluginPath, pluginConfig]] },
  };

  if (swcOptions.jsc?.transform) {
    jsc.transform = swcOptions.jsc.transform;
  }

  const options: Options = {
    // A bundler virtual root such as `[project]/…` is not a filesystem path
    // and must reach the plugin untouched.
    filename: (swcOptions.filename ?? "tests/e2e/Button.jsx").startsWith("[")
      ? swcOptions.filename!
      : path.resolve(swcOptions.filename ?? "tests/e2e/Button.jsx"),
    jsc,
  };
  if (swcOptions.isModule !== undefined) {
    options.isModule = swcOptions.isModule;
  }

  return transformSync(source, options).code;
}

/** SWC options that enable the automatic runtime + React Compiler. */
export const reactCompiler: Pick<Options, "jsc"> = {
  jsc: { transform: { react: { runtime: "automatic" }, reactCompiler: true } },
};

/** Run source through @swc/core with no plugin — the host on its own. */
export function swc(
  source: string,
  swcOptions: Pick<Options, "jsc"> = {},
  filename = "tests/e2e/Button.jsx",
): string {
  return transformSync(source, {
    filename: path.resolve(filename),
    jsc: { parser: { syntax: "typescript", tsx: true }, ...swcOptions.jsc },
  }).code;
}
