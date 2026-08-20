import assert from "node:assert/strict";
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
  const file = `${process.cwd()}/tests/e2e/Button.jsx`;

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
