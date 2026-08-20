import assert from "node:assert/strict";
import path from "node:path";
import {test} from "node:test";

import {reactCompiler, transform} from "./helpers.ts";

const NESTED = `function GameModeNav() {
  return (
    <nav>
      <ul>
        <li><Item /></li>
      </ul>
    </nav>
  );
}`;

test("annotates every element with file, line and column", () => {
  const code = transform(NESTED);

  // Columns are counted from 1, the way an editor reports them.
  for (const [tag, position] of [
    ['"nav"', "3:5"],
    ['"ul"', "4:7"],
    ['"li"', "5:9"],
    ["Item", "5:13"],
  ] as const) {
    assert.match(
      code,
      new RegExp(
        `createElement\\(${tag}, \\{\\s+"data-source-path": "tests/e2e/Button\\.jsx:${position}"\\s+\\}`
      )
    );
  }
});

test("drops the position when asked", () => {
  const code = transform(NESTED, {position: false});

  assert.match(code, /"data-source-path": "tests\/e2e\/Button\.jsx"/);
  assert.doesNotMatch(code, /Button\.jsx:\d/);
});

test("uses a custom attribute name", () => {
  const code = transform(NESTED, {"source-path-attr": "data-tsd-source"});

  assert.match(code, /"data-tsd-source": "tests\/e2e\/Button\.jsx:3:5"/);
  assert.doesNotMatch(code, /data-source-path/);
});

test("uses a camelCase attribute name for React Native", () => {
  const code = transform(NESTED, {native: true});

  assert.match(code, /dataSourcePath: "tests\/e2e\/Button\.jsx:3:5"/);
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
  assert.match(code, /"data-source-path": "tests\/e2e\/Button\.jsx:10:10"/);
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
  assert.match(
    code,
    /"span", \{\s+"data-source-path": "tests\/e2e\/Button\.jsx:4:7"/
  );
});

test("defaults the root to the working directory", () => {
  const code = transform(`function Button() { return <div />; }`);

  assert.match(code, /"data-source-path": "tests\/e2e\/Button\.jsx:1:28"/);
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
    new RegExp(`"data-source-path": "${enclosing}/tests/e2e/Button\\.jsx:1:28"`)
  );
});

test("takes an absolute root-dir verbatim", () => {
  const code = transform(`function Button() { return <div />; }`, {
    "root-dir": process.cwd(),
  });

  assert.match(code, /"data-source-path": "tests\/e2e\/Button\.jsx:1:28"/);
});

test("falls back to the bare path under the React Compiler", () => {
  const code = transform(NESTED, {}, reactCompiler);

  // The compiler rebuilds the JSX tree with no source spans, so there is no
  // position left to report. Asking the host to resolve those spans would
  // panic the build, so the plugin emits the path alone.
  assert.match(code, /"data-source-path": "tests\/e2e\/Button\.jsx"/);
  assert.doesNotMatch(code, /Button\.jsx:\d/);
  assert.equal((code.match(/data-source-path/g) ?? []).length, 4);
});

test("annotates nothing when the file sits outside root-dir", () => {
  const code = transform(`function Button() { return <div />; }`, {
    "root-dir": "/somewhere/else",
  });

  // Not project source, so there is no project-relative position to report.
  assert.doesNotMatch(code, /data-source-path/);
});

test("annotates nothing inside a dependency", () => {
  const code = transform(
    `export function Button(props) {
  return <button className="lib-button" {...props} />;
}

export function Card({title}) {
  return <div className="lib-card"><h2>{title}</h2></div>;
}`,
    {},
    {filename: "node_modules/some-lib/dist/index.js"}
  );

  assert.doesNotMatch(code, /data-source-path/);
});

test("annotates a library component at the call site in project code", () => {
  const code = transform(`import {Button} from "some-lib";

function App() {
  return <Button label="hi" />;
}`);

  // What you want when you click a library component is the line in your own
  // code that rendered it — which is exactly where this element sits.
  assert.match(code, /"data-source-path": "tests\/e2e\/Button\.jsx:4:10"/);
});
