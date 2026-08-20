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

test("takes a camelCase attribute name as written", () => {
  const code = transform(NESTED, {"source-path-attr": "dataSourcePath"});

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

test("lets a forwarded props spread win over the element's own value", () => {
  const code = transform(`function Passthrough(props) {
  return <div {...props} />;
}

function Rest({ children, ...rest }) {
  return <section {...rest}>{children}</section>;
}

function Unrelated() {
  return <article {...somethingElse} />;
}`);

  // Every element is annotated, but the attribute goes in *first*, so a
  // caller's forwarded value overwrites it at runtime. Getting this through
  // ordering rather than through code inspection is what keeps server and
  // client agreeing under Turbopack.
  assert.equal((code.match(/data-source-path/g) ?? []).length, 3);
  for (const spread of ["props", "rest", "somethingElse"]) {
    assert.match(
      code,
      new RegExp(`"data-source-path": "[^"]*"[\\s\\S]{0,80}?${spread}`)
    );
  }
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

test("reads a relative root-dir naming the working directory as that directory", () => {
  // The webpack half of a monorepo config: `root-dir: apps/web` is what
  // Turbopack needs, since it measures paths from the repo root, but webpack
  // runs the same build from inside `apps/web`. Joined there it would ask for
  // `apps/web/apps/web`, which no file is under, and every attribute would go.
  const here = path.basename(process.cwd());
  const code = transform(`function Button() { return <div />; }`, {
    "root-dir": here,
  });

  assert.match(code, /"data-source-path": "tests\/e2e\/Button\.jsx:1:28"/);
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

test("handles Turbopack's virtual project root", () => {
  // Turbopack does not hand plugins filesystem paths; it addresses modules as
  // `[project]/…`. Measuring that against an absolute root rejects every file,
  // which silently disables the plugin under Next.js.
  const code = transform(`function Card() { return <article />; }`, {}, {
    filename: "[project]/src/components/Card.tsx",
  });

  assert.match(code, /"data-source-path": "src\/components\/Card\.tsx:1:26"/);
});

test("strips a relative root-dir from a project-relative path", () => {
  // What Next.js 16.3 actually hands the plugin — no `[project]/` prefix, just
  // the path measured from the workspace root
  const code = transform(`function Card() { return <article />; }`, {
    "root-dir": "apps/web",
  }, {
    filename: "apps/web/src/components/Card.tsx",
  });

  assert.match(code, /"data-source-path": "src\/components\/Card\.tsx:1:26"/);
});

test("strips a relative root-dir from a virtual path", () => {
  // In a monorepo Turbopack roots the project at the repo, so a package build
  // reports `[project]/apps/web/…`. A relative root-dir is the only form that
  // can drop the workspace prefix — the absolute one names a location the
  // virtual path never reveals.
  const code = transform(`function Card() { return <article />; }`, {
    "root-dir": "apps/web",
  }, {
    filename: "[project]/apps/web/src/components/Card.tsx",
  });

  assert.match(code, /"data-source-path": "src\/components\/Card\.tsx:1:26"/);

  // And a sibling package is outside that root, so it is not project source
  const sibling = transform(`function Card() { return <article />; }`, {
    "root-dir": "apps/web",
  }, {
    filename: "[project]/packages/ui/src/Card.tsx",
  });

  assert.doesNotMatch(sibling, /data-source-path/);
});

test("skips dependencies and bundler code behind a virtual root", () => {
  const dependency = transform(`function L() { return <span />; }`, {}, {
    filename: "[project]/node_modules/some-lib/index.js",
  });
  const bundler = transform(`function N() { return <span />; }`, {}, {
    filename: "[next]/dist/client/app.js",
  });

  assert.doesNotMatch(dependency, /data-source-path/);
  assert.doesNotMatch(bundler, /data-source-path/);
});

test("leaves an ignored file alone", () => {
  const code = transform(`function Spec() { return <div />; }`, {
    ignore: {files: ["*.test.jsx"]},
  }, {filename: "tests/e2e/Button.test.jsx"});

  assert.doesNotMatch(code, /data-source-path/);
});

test("leaves ignored components alone, but not their children", () => {
  const code = transform(`function App() {
  return (
    <Providers>
      <ButtonLazy>
        <span />
      </ButtonLazy>
    </Providers>
  );
}`, {ignore: {components: ["Providers", "*Lazy"]}});

  assert.doesNotMatch(code, /"data-source-path": "[^"]*:3:5"/);
  assert.doesNotMatch(code, /"data-source-path": "[^"]*:4:7"/);
  // The child of an ignored component is still project code the author wrote
  assert.match(code, /"data-source-path": "tests\/e2e\/Button\.jsx:5:9"/);
});

test("a RegExp in ignore cannot survive the JSON boundary", () => {
  // Documents why the option takes glob strings: SWC serializes the plugin
  // config with JSON.stringify, and a RegExp comes out the other side as {}
  const code = transform(`function App() { return <ButtonLazy />; }`, {
    ignore: {components: [/.*Lazy$/]},
  });

  assert.match(code, /data-source-path/);
});
