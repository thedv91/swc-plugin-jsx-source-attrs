import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { annotate as loaderAnnotate, runLoader } from "./loader-helpers.ts";
import { reactCompiler, swc } from "./helpers.ts";

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
  const code = runLoader(NESTED);

  // Columns are counted from 1, the way an editor reports them.
  for (const [tag, position] of [
    ["nav", "3:5"],
    ["ul", "4:7"],
    ["li", "5:9"],
    ["Item", "5:13"],
  ] as const) {
    assert.match(code, new RegExp(`<${tag} data-tsd-source="tests/e2e/Button\\.jsx:${position}"`));
  }
});

test("keeps every element on the line it was written at", () => {
  // The whole point of splicing rather than regenerating: a position the
  // loader emits has to still be true of the file the loader emits.
  const lines = runLoader(NESTED).split("\n");

  for (const [line, tag] of [
    [3, "nav"],
    [4, "ul"],
    [5, "li"],
  ] as const) {
    assert.match(lines[line - 1]!, new RegExp(`<${tag} `));
  }
});

test("survives the React Compiler, which the plugin cannot", () => {
  // The reason this loader exists. React Compiler rebuilds the JSX tree with
  // no spans, so a plugin downstream of it has no position left to read -- but
  // an attribute that was already a string literal comes through untouched.
  const code = swc(runLoader(NESTED), reactCompiler);

  assert.match(code, /"data-tsd-source": "tests\/e2e\/Button\.jsx:3:5"/);
  assert.equal((code.match(/data-tsd-source/g) ?? []).length, 4);
});

test("drops the position when asked", () => {
  const code = runLoader(NESTED, { position: false });

  assert.match(code, /<nav data-tsd-source="tests\/e2e\/Button\.jsx">/);
  assert.doesNotMatch(code, /Button\.jsx:\d/);
});

test("uses a custom attribute name", () => {
  const code = runLoader(NESTED, { "source-path-attr": "data-source-path" });

  assert.match(code, /<nav data-source-path="tests\/e2e\/Button\.jsx:3:5">/);
  assert.doesNotMatch(code, /data-tsd-source/);
});

test("skips fragments, which have no host node", () => {
  const code = runLoader(`import React from 'react';

function Shell() {
  return (
    <>
      <Fragment><span>a</span></Fragment>
      <React.Fragment><em>b</em></React.Fragment>
    </>
  );
}`);

  assert.doesNotMatch(code, /<Fragment data-tsd-source/);
  assert.doesNotMatch(code, /<React\.Fragment data-tsd-source/);
  // Their children are still annotated.
  assert.match(code, /<span data-tsd-source/);
  assert.match(code, /<em data-tsd-source/);
});

test("leaves an element that already carries the attribute", () => {
  const code = runLoader(
    `function Button() { return <div data-tsd-source="written/by/hand.tsx:1:1" />; }`,
  );

  assert.match(code, /data-tsd-source="written\/by\/hand\.tsx:1:1"/);
  assert.equal((code.match(/data-tsd-source/g) ?? []).length, 1);
});

test("inserts before the attributes, so a later spread wins", () => {
  // Insertion order is what forwards a caller's annotation through a wrapper:
  // `{...props}` comes after and overwrites, exactly as it does for the plugin.
  const code = runLoader(`function Wrapper(props) { return <div {...props} />; }`);

  assert.match(code, /<div data-tsd-source="[^"]+" \{\.\.\.props\}/);
});

test("keeps type arguments attached to the element name", () => {
  const code = runLoader(
    `function Grid() { return <Table<Row> rows={rows} />; }`,
    {},
    "tests/e2e/Grid.tsx",
  );

  assert.match(code, /<Table<Row> data-tsd-source="tests\/e2e\/Grid\.tsx:1:26" rows=/);
});

test("ignores files by glob, wherever they sit", () => {
  const options = { ignore: { files: ["*.test.tsx"] } };

  assert.doesNotMatch(runLoader(NESTED, options, "tests/e2e/Button.test.tsx"), /data-tsd-source/);
  assert.match(runLoader(NESTED, options, "tests/e2e/Button.tsx"), /data-tsd-source/);
});

test("ignores components by glob, but not their children", () => {
  const code = runLoader(
    `function List() {
  return (
    <ItemLazy>
      <span>a</span>
    </ItemLazy>
  );
}`,
    { ignore: { components: ["*Lazy"] } },
  );

  assert.doesNotMatch(code, /<ItemLazy data-tsd-source/);
  assert.match(code, /<span data-tsd-source/);
});

test("annotates nothing inside a dependency", () => {
  const code = runLoader(NESTED, {}, "node_modules/some-lib/dist/Button.jsx");

  assert.doesNotMatch(code, /data-tsd-source/);
});

test("annotates nothing when the file sits outside root-dir", () => {
  const code = runLoader(NESTED, {
    "root-dir": path.resolve("somewhere/else"),
  });

  assert.doesNotMatch(code, /data-tsd-source/);
});

test("measures the path from root-dir", () => {
  const code = runLoader(NESTED, { "root-dir": "tests" }, "tests/e2e/Button.jsx");

  assert.match(code, /data-tsd-source="e2e\/Button\.jsx:3:5"/);
});

test("reads a relative root-dir the build already runs in as that directory", () => {
  // One config for both bundlers: Turbopack measures from the repo root, so
  // `root-dir` names the package; webpack runs the build from inside it, where
  // joining would look for `tests/e2e/tests/e2e` and match nothing.
  const code = runLoader(NESTED, { "root-dir": "tests/e2e" }, "tests/e2e/Button.jsx", {
    rootContext: path.resolve("tests/e2e"),
  });

  assert.match(code, /data-tsd-source="Button\.jsx:3:5"/);
});

test("leaves a file with no JSX exactly as it was", () => {
  const source = `export const sum = (a, b) => a + b;\n`;

  assert.equal(runLoader(source, {}, "tests/e2e/sum.jsx"), source);
});

test("returns its result when the host provides no callback", () => {
  const code = runLoader(NESTED, {}, "tests/e2e/Button.jsx", { withoutCallback: true });

  assert.match(code, /<nav data-tsd-source="tests\/e2e\/Button\.jsx:3:5">/);
});

test("annotates JSX written in a .js file", () => {
  // A rule that names `*.js` is a clear enough statement of intent, and plenty
  // of projects still write JSX there.
  for (const filename of ["tests/e2e/Legacy.js", "tests/e2e/Legacy.mjs", "tests/e2e/Legacy.cjs"]) {
    assert.match(runLoader(NESTED, {}, filename), /data-tsd-source="tests\/e2e\/Legacy\./);
  }
});

test("leaves .ts alone, where a generic arrow reads as JSX", () => {
  // `<T>(x) => x` parses as an unclosed element once the `jsx` plugin is on,
  // so a `.ts` file cannot be handled by guessing.
  const source = `export const identity = <T>(x: T): T => x;\n`;

  assert.equal(runLoader(source, {}, "tests/e2e/identity.ts"), source);
});

test("hands back source it cannot parse, rather than failing the build", () => {
  // Decorators are valid syntax needing a parser plugin this loader does not
  // enable, so they throw out of `parse` -- `errorRecovery` only covers errors
  // Babel can recover from.
  const decorated = `@Injectable() class A { render() { return <div />; } }`;
  assert.equal(runLoader(decorated, {}, "tests/e2e/Decorated.tsx"), decorated);

  const broken = `function A() { return <div><<>>/div>; }`;
  assert.equal(runLoader(broken), broken);
});

test("rejects a RegExp in ignore, naming the option", () => {
  // The plugin never sees one -- JSON collapses `/x/` to `{}` on the way into
  // wasm. The loader is handed the object itself, so a config ported from
  // TanStack Devtools arrives with the regex intact.
  for (const [option, ignore] of [
    ["ignore.components", { components: [/Lazy$/] }],
    ["ignore.files", { files: [/test/] }],
  ] as const) {
    assert.throws(() => runLoader(NESTED, { ignore } as never), {
      name: "TypeError",
      message: new RegExp(`\`${option.replace(".", "\\.")}\` must be an array of glob strings`),
    });
  }
});

test("escapes a quote in the path, which would end the attribute", () => {
  const code = loaderAnnotate(`const a = <div />;`, { sourcePath: 'we"ird/App.jsx' });

  assert.match(code, /data-tsd-source="we&quot;ird\/App\.jsx:1:11"/);
  // The point of the escape: what comes out still parses.
  assert.doesNotThrow(() => swc(code));
});

test("counts columns in characters, as the plugin does", () => {
  // Not display columns: a tab is one character here and at least four on
  // screen, and the editor the attribute is handed to counts characters.
  const tabbed = runLoader("function A() {\n\treturn <div />;\n}");

  assert.match(tabbed, /data-tsd-source="tests\/e2e\/Button\.jsx:2:9"/);
});
