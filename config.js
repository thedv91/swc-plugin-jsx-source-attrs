// Config builders, so a bundler rule is one call with the option names
// autocompleted rather than a nested literal copied from the README.
//
// They return the rule, not a whole config: a project usually has other rules,
// and something that merged them for you would have to know which bundler's
// merge semantics to apply. Spreading is clearer than a merge nobody can see.

"use strict";

// Resolved rather than passed through as the bare specifier: under pnpm's
// default layout a project can require `swc-plugin-jsx-source-attrs` while the
// bundler, resolving from somewhere else, cannot see it. This module can
// always find its own sibling.
const LOADER = require.resolve("./loader/index.js");

/** Extensions worth matching by default. `.ts` is excluded -- see the loader. */
const DEFAULT_EXTENSIONS = ["jsx", "tsx"];

/**
 * Whether to wire the loader in at all, when `enabled` was not given.
 *
 * This is a development tool: it puts an attribute on every element and
 * inflates the output, so the default is the one build that wants it. Read at
 * call time rather than at import, because a config file is loaded by more than
 * one process and not all of them set `NODE_ENV` before the import runs.
 *
 * @returns {boolean}
 */
function enabledByDefault() {
  return process.env.NODE_ENV === "development";
}

/**
 * @typedef {import("./loader/index.d.ts").LoaderOptions} LoaderOptions
 */

/**
 * A `turbopack.rules` entry (`experimental.turbo.rules` before Next.js 16).
 *
 * ```ts
 * turbopack: {rules: turbopackRules({ignore: {files: ["*.test.tsx"]}})}
 * ```
 *
 * Wired in only when `NODE_ENV` is `development` unless `enabled` says
 * otherwise; disabled, it returns an empty object.
 *
 * @param {LoaderOptions & {extensions?: string[], enabled?: boolean}} [options]
 * @returns {Record<string, {loaders: {loader: string, options: LoaderOptions}[]}>}
 */
function turbopackRules(options = {}) {
  const {
    extensions = DEFAULT_EXTENSIONS,
    enabled = enabledByDefault(),
    ...loaderOptions
  } = options;

  // No entry at all rather than an entry that matches nothing: spreading this
  // into a `rules` object then adds exactly nothing.
  if (!enabled) return {};

  // One glob rather than one entry per extension: two entries whose globs both
  // match a file is a conflict Turbopack resolves by picking one, and which one
  // is not something to rely on.
  return {
    [`*.{${extensions.join(",")}}`]: {
      loaders: [{ loader: LOADER, options: loaderOptions }],
    },
  };
}

/**
 * A `module.rules` entry for webpack (and Rspack, which takes the same shape).
 *
 * ```js
 * module: {rules: [webpackRule(), ...]}
 * ```
 *
 * Wired in only when `NODE_ENV` is `development` unless `enabled` says
 * otherwise; disabled, it returns a rule that matches nothing.
 *
 * @param {LoaderOptions & {test?: RegExp, enabled?: boolean}} [options]
 * @returns {{test: RegExp, exclude?: RegExp, use?: {loader: string, options: LoaderOptions}}}
 */
function webpackRule(options = {}) {
  const { test = /\.[cm]?[jt]sx$/, enabled = enabledByDefault(), ...loaderOptions } = options;

  // A rule has to be an object -- an array of rules is not the place to return
  // nothing -- so a disabled one is a rule that matches no filename and loads
  // nothing if it somehow did. `(?!)` is a negative lookahead on the empty
  // string, which can never succeed.
  if (!enabled) return { test: /(?!)/ };

  // `exclude` is belt and braces: the loader drops anything under
  // `node_modules` on its own. Not running it at all is still cheaper.
  return {
    test,
    exclude: /node_modules/,
    use: { loader: LOADER, options: loaderOptions },
  };
}

module.exports = { turbopackRules, webpackRule, loaderPath: LOADER };
