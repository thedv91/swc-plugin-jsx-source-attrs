import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const config = require("../../config.js") as typeof import("../../config.d.ts");

// The builders are off outside `next dev` now, and these cases are about the
// rule they build rather than about when it is built.
process.env.NODE_ENV = "development";

test("builds a Turbopack rule that names one glob", () => {
  const rules = config.turbopackRules();

  assert.deepEqual(Object.keys(rules), ["*.{jsx,tsx}"]);
  assert.equal(rules["*.{jsx,tsx}"]!.loaders.length, 1);
});

test("passes the loader options through, minus the ones it owns", () => {
  const rules = config.turbopackRules({
    extensions: ["tsx"],
    position: false,
    ignore: { files: ["*.test.tsx"] },
  });

  const entry = rules["*.{tsx}"];
  assert.ok(entry, "the rule is keyed by the extensions given");
  assert.deepEqual(entry.loaders[0]!.options, {
    position: false,
    ignore: { files: ["*.test.tsx"] },
  });
});

test("points at a loader that exists and loads", () => {
  // The rule is worth nothing if the path in it cannot be required -- which is
  // the failure `require.resolve` at build time is there to prevent.
  const { loader } = config.turbopackRules()["*.{jsx,tsx}"]!.loaders[0]!;

  assert.equal(loader, path.resolve("loader/index.js"));
  assert.equal(typeof require(loader), "function");
});

test("builds a webpack rule that skips dependencies", () => {
  const rule = config.webpackRule({ "root-dir": "apps/web" });

  assert.ok(rule.test.test("src/App.tsx"));
  assert.ok(rule.test.test("src/App.jsx"));
  assert.ok(!rule.test.test("src/App.ts"));
  assert.ok(rule.exclude!.test("node_modules/some-lib/dist/Button.jsx"));
  assert.deepEqual(rule.use!.options, { "root-dir": "apps/web" });
});

test("takes a custom test regex", () => {
  const rule = config.webpackRule({ test: /\.tsx$/ });

  assert.ok(!rule.test.test("src/App.jsx"));
  assert.deepEqual(rule.use!.options, {});
});

test("wires in only under NODE_ENV=development by default", () => {
  // The default is read when the builder is called, not when it is imported:
  // a config file is loaded by more than one process, and not all of them have
  // set NODE_ENV by import time.
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    assert.deepEqual(Object.keys(config.turbopackRules()), ["*.{jsx,tsx}"]);

    process.env.NODE_ENV = "production";
    assert.deepEqual(config.turbopackRules(), {});
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("takes enabled either way, whatever NODE_ENV says", () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.deepEqual(Object.keys(config.turbopackRules({ enabled: true })), ["*.{jsx,tsx}"]);

    process.env.NODE_ENV = "development";
    assert.deepEqual(config.turbopackRules({ enabled: false }), {});
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("a disabled webpack rule matches no filename and loads nothing", () => {
  const rule = config.webpackRule({ enabled: false });

  assert.ok(!rule.test.test("src/App.tsx"));
  assert.ok(!rule.test.test(""));
  assert.equal(rule.use, undefined);
});

test("enabled is not passed on to the loader", () => {
  const rules = config.turbopackRules({ enabled: true, position: false });

  assert.deepEqual(rules["*.{jsx,tsx}"]!.loaders[0]!.options, { position: false });
});
