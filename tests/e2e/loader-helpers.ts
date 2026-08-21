import { createRequire } from "node:module";
import path from "node:path";

// `export =` types, reached the way an ESM file has to reach them.
export type LoaderOptions = import("../../loader/index.d.ts").LoaderOptions;

const require = createRequire(import.meta.url);
// The loader is plain CommonJS, published as-is: loading it the way a bundler
// does is the only way to test what ships.
const loader = require("../../loader/index.js") as typeof import("../../loader/index.d.ts");

/** The source-level transform on its own, without the loader context around it. */
export const annotate = loader.annotate;

export interface LoaderContext {
  rootContext?: string;
  /**
   * Drop `this.callback`, leaving the loader to return its result instead.
   *
   * Every real bundler provides it, so that is what these tests use by default;
   * this covers the fallback arm, which is what runs under a host implementing
   * only the synchronous half of the loader API.
   */
  withoutCallback?: boolean;
}

/** Drive the loader with the loader-context fields it actually reads. */
export function runLoader(
  source: string,
  options: LoaderOptions = {},
  filename = "tests/e2e/Button.jsx",
  context: LoaderContext = {},
): string {
  const base = {
    resourcePath: path.resolve(filename),
    rootContext: context.rootContext ?? process.cwd(),
    getOptions: () => options,
    cacheable: () => {},
  };

  if (context.withoutCallback) {
    // Typed `string | void` because a host with a callback gets nothing back;
    // this arm is exactly the one that returns.
    return loader.call(base, source) as string;
  }

  let result: string | undefined;
  let failure: unknown;
  loader.call(
    {
      ...base,
      callback: (error: unknown, code: string) => {
        failure = error;
        result = code;
      },
    },
    source,
  );

  if (failure) throw failure;
  if (result === undefined) throw new Error("the loader neither called back nor returned");
  return result;
}
