// The loader is checked against @babel/parser v8 here, and against the v7 the
// repository installs everywhere else. Both majors are supported, and the two
// differ in ways that reach this code: v8 is ESM-only, and it renamed the JSX
// generic node from `typeParameters` to `typeArguments`.
//
// v8 is installed under an alias so the two can sit side by side, and is swapped
// in through the one module that loads the parser -- the same seam the loader
// itself goes through, so nothing about the transform is being faked.

import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);

const parserV8 = require("@babel/parser-v8") as typeof import("@babel/parser");

const parserModulePath = require.resolve("../../loader/parser.js");
const stub = new Module(parserModulePath);
stub.exports = { parse: parserV8.parse };
stub.loaded = true;
require.cache[parserModulePath] = stub;

const loader = require("../../loader/index.js") as ((this: unknown, source: string) => string) & {
  annotate: (source: string, options: { sourcePath: string; filename?: string }) => string;
};

function runLoader(source: string, filename = "tests/e2e/Button.jsx"): string {
  return loader.call(
    {
      resourcePath: path.resolve(filename),
      rootContext: process.cwd(),
      getOptions: () => ({}),
      cacheable: () => {},
    },
    source,
  );
}

test("v8 is the parser under test", () => {
  const version = (require("@babel/parser-v8/package.json") as { version: string }).version;

  assert.match(version, /^8\./);
});

test("annotates with the same positions v7 produces", () => {
  const code = runLoader(`function GameModeNav() {
  return (
    <nav>
      <ul>
        <li><Item /></li>
      </ul>
    </nav>
  );
}`);

  for (const [tag, position] of [
    ["nav", "3:5"],
    ["ul", "4:7"],
    ["li", "5:9"],
    ["Item", "5:13"],
  ] as const) {
    assert.match(code, new RegExp(`<${tag} data-tsd-source="tests/e2e/Button\\.jsx:${position}"`));
  }
});

test("keeps type arguments attached, which v8 renamed", () => {
  // v7 calls this node `typeParameters`, v8 `typeArguments`. Reading the wrong
  // one inserts between `<Table` and `<Row>` and produces a syntax error rather
  // than a wrong position, so this is the difference that actually bites.
  const code = runLoader(
    `function Grid() { return <Table<Row> rows={rows} />; }`,
    "tests/e2e/Grid.tsx",
  );

  assert.match(code, /<Table<Row> data-tsd-source="tests\/e2e\/Grid\.tsx:1:26" rows=/);
});

test("skips fragments and lets a later spread win", () => {
  const fragments = runLoader(`import React from 'react';

function Shell() {
  return (
    <>
      <Fragment><span>a</span></Fragment>
    </>
  );
}`);

  assert.doesNotMatch(fragments, /<Fragment data-tsd-source/);
  assert.match(fragments, /<span data-tsd-source/);

  const spread = runLoader(`function Wrapper(props) { return <div {...props} />; }`);

  assert.match(spread, /<div data-tsd-source="[^"]+" \{\.\.\.props\}/);
});
