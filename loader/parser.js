// Loading `@babel/parser`, which is two different packages depending on the
// major:
//
//   v7 is CommonJS, and `require` returns its exports directly.
//   v8 is ESM-only (`"type": "module"`, one `./lib/index.js` export). `require`
//     of an ES module is what Node does from 22.12 on, and v8's own `engines`
//     already demand ^22.18 || >=24.11 -- so on any Node that can install v8,
//     this works and hands back the module namespace.
//
// The namespace exposes `parse` as a named export and no `default`, so reading
// `parse` off whatever came back covers both without a version check. The
// `default` arm is there for a bundler that wraps the namespace in one.

"use strict";

/** @type {any} */
let parser;
try {
  parser = require("@babel/parser");
} catch (error) {
  // Node < 22.12 cannot require an ES module at all, so a v8 install on an old
  // runtime fails here rather than at the first parse -- with a message that
  // names the actual fix instead of `ERR_REQUIRE_ESM`.
  const message =
    /** @type {NodeJS.ErrnoException} */ (error).code === "ERR_REQUIRE_ESM"
      ? "swc-plugin-jsx-source-attrs/loader: @babel/parser v8 is ESM-only and this Node cannot require it. " +
        "Use Node >= 22.12, or pin @babel/parser to ^7."
      : /** @type {Error} */ (error).message;
  throw new Error(message, { cause: error });
}

/** @type {typeof import("@babel/parser").parse} */
const parse = parser.parse ?? parser.default?.parse;

module.exports = { parse };
