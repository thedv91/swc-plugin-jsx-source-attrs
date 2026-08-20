import assert from "node:assert/strict";
import path from "node:path";
import {test} from "node:test";

import {transform} from "./helpers.ts";

const NESTED = `function GameModeNav() {
  return (
    <nav>
      <ul>
        <li><Item /></li>
      </ul>
    </nav>
  );
}`;

test("annotates every element with its source file", () => {
  const code = transform(NESTED);
  const file = "tests/e2e/Button.jsx";

  for (const tag of ['"nav"', '"ul"', '"li"', "Item"]) {
    assert.match(
      code,
      new RegExp(
        `createElement\\(${tag}, \\{\\s+"data-source-path": "${file}"\\s*[,}]`
      )
    );
  }
});

test("uses a custom attribute name", () => {
  const code = transform(NESTED, {"source-path-attr": "data-tsd-source"});

  assert.match(code, /"data-tsd-source":/);
  assert.doesNotMatch(code, /data-source-path/);
});

test("uses a camelCase attribute name for React Native", () => {
  const code = transform(NESTED, {native: true});

  assert.match(code, /dataSourcePath:/);
});

test("skips fragments, which have no host node", () => {
  const code = transform(`import React from 'react';

function Shell() {
  return (
    <>
      <Fragment><span>a</span></Fragment>
      <React.Fragment><em>b</em></React.Fragment>
    </>
  );
}`);

  assert.doesNotMatch(code, /Fragment, \{/);
  assert.match(code, /"span", \{\s+"data-source-path"/);
  assert.match(code, /"em", \{\s+"data-source-path"/);
});

test("skips an element that spreads the enclosing props", () => {
  const code = transform(`function Passthrough(props) {
  return <div {...props} />;
}

function Rest({ children, ...rest }) {
  return <section {...rest}>{children}</section>;
}

function Unrelated() {
  return <article {...somethingElse} />;
}`);

  // Spreading the caller's props forwards whatever they already annotated;
  // appending here would replace their position with this wrapper's.
  assert.match(code, /createElement\("div", props\)/);

  // Of the three elements only <article /> is annotated: its spread is some
  // unrelated object, not the enclosing props.
  assert.equal((code.match(/data-source-path/g) ?? []).length, 1);
});

test("does not overwrite an attribute already on the element", () => {
  const code = transform(`function Shell() {
  return (
    <div data-source-path="hand-written">
      <span>sibling</span>
    </div>
  );
}`);

  assert.match(code, /"data-source-path": "hand-written"/);
  assert.equal((code.match(/data-source-path/g) ?? []).length, 2);
});

test("defaults the root to the working directory", () => {
  const code = transform(`function Button() { return <div />; }`);

  assert.match(code, /"data-source-path": "tests\/e2e\/Button\.jsx"/);
});

test("anchors a relative root-dir to the working directory", () => {
  // Standing in for a monorepo app that wants repo-root-relative paths:
  // ".." climbs out of the package the build is running in.
  const enclosing = path.basename(process.cwd());
  const code = transform(`function Button() { return <div />; }`, {
    "root-dir": "..",
  });

  assert.match(
    code,
    new RegExp(`"data-source-path": "${enclosing}/tests/e2e/Button\\.jsx"`)
  );
});

test("takes an absolute root-dir verbatim", () => {
  const code = transform(`function Button() { return <div />; }`, {
    "root-dir": process.cwd(),
  });

  assert.match(code, /"data-source-path": "tests\/e2e\/Button\.jsx"/);
});
