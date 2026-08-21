import type jsxSourceAttrsLoader from "./loader/index.d.ts";

type LoaderOptions = jsxSourceAttrsLoader.LoaderOptions;

interface EnableOption {
  /**
   * Whether to wire the loader in at all.
   *
   * Default: `process.env.NODE_ENV === "development"`, read when the builder is
   * called. This is a development tool — it puts an attribute on every element
   * and inflates the output — so the default is the one build that wants it.
   * Set it explicitly to instrument a production build, or to turn the loader
   * off in dev behind a flag of your own.
   */
  enabled?: boolean;
}

export interface TurbopackRuleOptions extends LoaderOptions, EnableOption {
  /**
   * Extensions the rule matches. Default: `["jsx", "tsx"]`.
   *
   * `ts` is not among them and adding it does nothing useful: with the JSX
   * parser on, `<T>(x) => x` reads as an unclosed element, so the loader skips
   * `.ts` whatever the rule says.
   */
  extensions?: string[];
}

export interface WebpackRuleOptions extends LoaderOptions, EnableOption {
  /** Files the rule matches. Default: `/\.[cm]?[jt]sx$/`. */
  test?: RegExp;
}

export interface TurbopackLoaderItem {
  loader: string;
  /**
   * Deliberately `any` rather than `LoaderOptions`.
   *
   * Next types a loader's options as `Record<string, JSONValue>`, and an
   * interface without an index signature is not assignable to one — so a
   * precise type here makes `turbopack: {rules: turbopackRules()}` fail to
   * typecheck in the very config file it exists to simplify. The options are
   * checked where it matters, on the builder's own parameter.
   */
  options: Record<string, any>;
}

export type TurbopackRules = Record<string, { loaders: TurbopackLoaderItem[] }>;

export interface WebpackRule {
  test: RegExp;
  /** Absent when disabled: the rule matches nothing and loads nothing. */
  exclude?: RegExp;
  use?: TurbopackLoaderItem;
}

/**
 * Build the `turbopack.rules` entry (`experimental.turbo.rules` before
 * Next.js 16). Spread it if the project has rules of its own.
 *
 * Returns `{}` when disabled, so spreading it adds nothing.
 */
export function turbopackRules(options?: TurbopackRuleOptions): TurbopackRules;

/**
 * Build a `module.rules` entry for webpack, or for Rspack, which matches it.
 *
 * Returns a rule matching no filename when disabled.
 */
export function webpackRule(options?: WebpackRuleOptions): WebpackRule;

/** Absolute path to the loader, for a rule you would rather write yourself. */
export const loaderPath: string;
