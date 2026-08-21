// Types for the loader, which is CommonJS and is loaded as CommonJS: `export =`
// describes what `require` actually hands back, rather than an ESM shape that
// only looks right until someone tries a named import at runtime.

/**
 * Returns the transformed source when the host provides no `this.callback`, and
 * nothing when it does -- the result went to the callback instead. Every real
 * bundler provides one.
 */
declare function jsxSourceAttrsLoader(this: unknown, source: string, map?: unknown): string | void;

declare namespace jsxSourceAttrsLoader {
  /** Options the loader takes, spelled exactly as the plugin's. */
  interface LoaderOptions {
    /** Attribute name to emit. Default: `data-tsd-source`. */
    "source-path-attr"?: string;
    /** Directory the emitted path is made relative to. Default: the build's working directory. */
    "root-dir"?: string;
    /** Append the element's own `:line:column`. Default: `true`. */
    position?: boolean;
    /** Project source to leave alone. Patterns are globs, not regexes. */
    ignore?: {
      /** Project-relative paths to skip entirely, e.g. `*.test.tsx`. */
      files?: string[];
      /** Element names to leave unannotated, e.g. `*Lazy`. */
      components?: string[];
    };
  }

  interface AnnotateOptions {
    /** Project-relative path to emit. */
    sourcePath: string;
    /** Attribute name. Default: `data-tsd-source`. */
    attr?: string;
    /** Append `:line:column`. Default: `true`. */
    position?: boolean;
    /** Element-name globs to skip. */
    ignoreComponents?: string[];
    /** Real filename, used only to pick the parser plugins. */
    filename?: string;
  }

  /**
   * Insert the attribute into every eligible JSX element of `source`.
   *
   * The loader itself resolves `root-dir` and the ignore rules and then calls
   * this; exported for tests and for anyone driving the transform without a
   * bundler.
   */
  function annotate(source: string, options: AnnotateOptions): string;
}

export = jsxSourceAttrsLoader;
