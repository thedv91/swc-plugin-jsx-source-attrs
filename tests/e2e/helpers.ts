import path from "node:path";
import {transformSync, type Options} from "@swc/core";

export type PluginConfig = Record<string, unknown>;

const pluginPath = path.resolve(
  "target/wasm32-unknown-unknown/release/swc_plugin_jsx_source_attrs.wasm"
);

/** Run source through @swc/core with the plugin wired in. */
export function transform(
  source: string,
  pluginConfig: PluginConfig = {},
  swcOptions: Pick<Options, "isModule" | "jsc" | "filename"> = {}
): string {
  const jsc: NonNullable<Options["jsc"]> = {
    parser: {syntax: "ecmascript", jsx: true},
    experimental: {plugins: [[pluginPath, pluginConfig]]},
  };

  if (swcOptions.jsc?.transform) {
    jsc.transform = swcOptions.jsc.transform;
  }

  const options: Options = {
    filename: path.resolve(swcOptions.filename ?? "tests/e2e/Button.jsx"),
    jsc,
  };
  if (swcOptions.isModule !== undefined) {
    options.isModule = swcOptions.isModule;
  }

  return transformSync(source, options).code;
}

/** SWC options that enable the automatic runtime + React Compiler. */
export const reactCompiler: Pick<Options, "jsc"> = {
  jsc: {transform: {react: {runtime: "automatic"}, reactCompiler: true}},
};
