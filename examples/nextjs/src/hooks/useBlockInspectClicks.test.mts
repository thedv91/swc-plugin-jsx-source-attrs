import assert from "node:assert/strict";
import { beforeEach, test, type TestContext } from "node:test";
import { JSDOM } from "jsdom";

// The hook only installs itself in development, and it reads the flag inside
// the effect -- so setting it here is enough, no bundler inlining involved.
// Cast because Next's ambient types declare `NODE_ENV` read-only, which holds
// for app code but not for the tests that have to exercise both branches.
const setNodeEnv = (value: string) => {
  (process.env as Record<string, string>).NODE_ENV = value;
};

setNodeEnv("development");

const jsdom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
const { window } = jsdom;

let fetched: Array<string> = [];
let fetchResult: () => Promise<unknown> = () => Promise.resolve({});

// The hook reaches for `addEventListener`, `document`, `localStorage` and
// `fetch` unqualified, so the globals have to be the very ones a dispatch in
// this file travels through. `defineProperty` rather than assignment: Node
// exposes `navigator` as a getter with no setter, which a plain write throws on.
for (const [name, value] of Object.entries({
  window,
  document: window.document,
  navigator: window.navigator,
  localStorage: window.localStorage,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  addEventListener: window.addEventListener.bind(window),
  removeEventListener: window.removeEventListener.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
  fetch: (url: unknown) => {
    fetched.push(String(url));
    return fetchResult();
  },
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

// Dynamic, so the globals above are in place before React DOM first looks for
// a document.
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useBlockInspectClicks } = await import("./useBlockInspectClicks.ts");

function Probe() {
  useBlockInspectClicks();
  return null;
}

/**
 * Render the hook, and return the unmount that runs its cleanup.
 *
 * Unmounting is registered on the test rather than left to the caller: a failed
 * assertion aborts the test body, and a listener still on `document` at that
 * point goes on blocking clicks in every test that follows.
 */
async function mount(t: TestContext) {
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
  });

  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };

  t.after(unmount);
  return unmount;
}

const press = (...keys: Array<string>) => {
  for (const key of keys) window.dispatchEvent(new window.KeyboardEvent("keydown", { key }));
};
const release = (...keys: Array<string>) => {
  for (const key of keys) window.dispatchEvent(new window.KeyboardEvent("keyup", { key }));
};
const blur = () => window.dispatchEvent(new window.Event("blur"));

/** The combination the hook defaults to, as `KeyboardEvent.key` values. */
const DEFAULT_COMBO = ["Shift", "Alt", "Control"] as const;

function element(source?: string) {
  const el = window.document.createElement("button");
  if (source !== undefined) el.setAttribute("data-tsd-source", source);
  window.document.body.append(el);
  return el;
}

/**
 * Click `target`, with `under` standing in for whatever `elementFromPoint`
 * would return -- jsdom does no layout, so the point lookup has to be supplied.
 */
function click(target: Element, under: Element | null = target) {
  window.document.elementFromPoint = () => under;

  let reached = false;
  const onClick = () => {
    reached = true;
  };
  target.addEventListener("click", onClick);
  const notPrevented = target.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }),
  );
  target.removeEventListener("click", onClick);

  return { reached, prevented: !notPrevented };
}

beforeEach(() => {
  window.localStorage.clear();
  window.document.body.replaceChildren();
  fetched = [];
  fetchResult = () => Promise.resolve({});
});

test("swallows the click that opened the file", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press(...DEFAULT_COMBO);
  const { reached, prevented } = click(el);

  // Both halves matter: `preventDefault` alone leaves React's `onClick` --
  // dispatched on the way up -- to fire anyway, which is the bug this exists for.
  assert.equal(prevented, true);
  assert.equal(reached, false, "the click never reaches the element it landed on");
});

test("leaves an ordinary click alone", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  const { reached, prevented } = click(el);

  assert.equal(prevented, false);
  assert.equal(reached, true);
  assert.deepEqual(fetched, []);
});

test("cancels the inspect when a key beyond the combo is held", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press(...DEFAULT_COMBO, "z");
  const { reached } = click(el);

  assert.equal(reached, true, "a fourth key cancels the inspect, as it does for the devtools");
});

test("takes Meta in place of Control", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press("Shift", "Alt", "Meta");
  const { reached } = click(el);

  assert.equal(reached, false);
});

test("arms on the hotkey the devtools settings last wrote", async (t) => {
  window.localStorage.setItem(
    "tanstack_devtools_settings",
    JSON.stringify({ inspectHotkey: ["Alt", "A"] }),
  );
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press(...DEFAULT_COMBO);
  assert.equal(click(el).reached, true, "the default combo is no longer the one that arms it");

  release(...DEFAULT_COMBO);
  press("Alt", "a");
  assert.equal(click(el).reached, false);
});

test("re-reads the hotkey on every click, so a panel edit needs no reload", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press("Alt", "a");
  assert.equal(click(el).reached, true);

  window.localStorage.setItem(
    "tanstack_devtools_settings",
    JSON.stringify({ inspectHotkey: ["Alt", "A"] }),
  );
  assert.equal(click(el).reached, false, "the same held keys now match");
});

test("falls back to the default when the stored hotkey is missing or unreadable", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");
  press(...DEFAULT_COMBO);

  window.localStorage.setItem("tanstack_devtools_settings", "}{ not json");
  assert.equal(click(el).reached, false);

  window.localStorage.setItem("tanstack_devtools_settings", JSON.stringify({ theme: "dark" }));
  assert.equal(click(el).reached, false);

  window.localStorage.setItem("tanstack_devtools_settings", JSON.stringify({ inspectHotkey: [] }));
  assert.equal(click(el).reached, false);
});

test("disarms when a modifier is released", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press(...DEFAULT_COMBO);
  release("Alt");
  const { reached } = click(el);

  assert.equal(reached, true);
});

test("disarms on blur, since an unfocused tab never sends the keyup", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press(...DEFAULT_COMBO);
  blur();
  const { reached } = click(el);

  assert.equal(reached, true);
});

test("survives typing a capital, which comes back up under a different name", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  // Shift+a goes down as "A"; release Shift first and the letter comes back up
  // as "a". Matched by name, that leaves an "A" nothing will ever release.
  press("Shift", "A");
  release("Shift", "a");

  press(...DEFAULT_COMBO);
  assert.equal(click(el).reached, false, "nothing is left held after the typing");
});

test("drops everything when Meta is released, which is all macOS reports", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  // Cmd+A: macOS never delivers the letter's keyup, only Meta's own.
  press("Meta", "a");
  release("Meta");

  press(...DEFAULT_COMBO);
  assert.equal(click(el).reached, false, "the letter did not outlive the Meta release");
});

test("disarms when a context menu opens, which also swallows the keyups", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press(...DEFAULT_COMBO);
  el.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

  assert.equal(click(el).reached, true, "the hold does not outlive the menu");
});

test("keeps the hold when the page handles the context menu itself", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");
  el.addEventListener("contextmenu", (e) => e.preventDefault());

  press(...DEFAULT_COMBO);
  el.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

  assert.equal(click(el).reached, false, "no menu opened, so no keyup was lost");
});

test("ignores a key event that carries no key at all", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press(...DEFAULT_COMBO);
  // A `<datalist>` pick reports no `key`. Recording it under a stand-in name
  // would add an entry nothing releases, and the blocker would never arm again.
  window.dispatchEvent(new window.Event("keydown"));

  assert.equal(click(el).reached, false, "the combo is still the only thing held");
});

test("opens the file at the line and column, as separate params", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press(...DEFAULT_COMBO);
  click(el);

  // Next's overlay answers 400 to the packed `file:line:column` the devtools
  // would send, so the split has to happen before the request.
  assert.deepEqual(fetched, [
    "/__nextjs_launch-editor?file=src%2Fapp%2Fpage.tsx&line1=12&column1=5",
  ]);
});

test("sends the bare path when the attribute carries no position", async (t) => {
  await mount(t);
  const el = element("src/app/page.tsx");

  press(...DEFAULT_COMBO);
  click(el);

  // The live case under the React Compiler, not a defensive branch.
  assert.deepEqual(fetched, ["/__nextjs_launch-editor?file=src%2Fapp%2Fpage.tsx"]);
});

test("keeps a path that itself contains a colon", async (t) => {
  await mount(t);
  const el = element("C:\\app\\page.tsx:12:5");

  press(...DEFAULT_COMBO);
  click(el);

  assert.deepEqual(fetched, [
    "/__nextjs_launch-editor?file=C%3A%5Capp%5Cpage.tsx&line1=12&column1=5",
  ]);
});

test("opens what is under the pointer, not what the event was dispatched on", async (t) => {
  await mount(t);
  const outer = element("src/app/outer.tsx:1:1");
  const inner = window.document.createElement("span");
  inner.setAttribute("data-tsd-source", "src/app/inner.tsx:9:3");
  outer.append(inner);

  press(...DEFAULT_COMBO);
  click(outer, inner);

  assert.deepEqual(fetched, [
    "/__nextjs_launch-editor?file=src%2Fapp%2Finner.tsx&line1=9&column1=3",
  ]);
});

test("blocks the click but opens nothing when the element has no source", async (t) => {
  await mount(t);
  const outer = element("src/app/outer.tsx:1:1");
  const inner = window.document.createElement("span");
  outer.append(inner);

  press(...DEFAULT_COMBO);
  const { reached, prevented } = click(outer, inner);

  // No ancestor walk: the devtools highlights what is under the pointer, and
  // opening its parent instead would open a file the user never pointed at.
  assert.deepEqual(fetched, []);
  assert.equal(prevented, true);
  assert.equal(reached, false);
});

test("swallows a failing launch-editor request", async (t) => {
  fetchResult = () => Promise.reject(new Error("no editor"));
  await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press(...DEFAULT_COMBO);
  assert.doesNotThrow(() => click(el));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fetched.length, 1);
});

test("stops blocking once unmounted", async (t) => {
  const unmount = await mount(t);
  const el = element("src/app/page.tsx:12:5");

  press(...DEFAULT_COMBO);
  await unmount();
  const { reached, prevented } = click(el);

  assert.equal(prevented, false);
  assert.equal(reached, true);
  assert.deepEqual(fetched, []);
});

test("installs nothing outside development", async (t) => {
  setNodeEnv("production");
  try {
    await mount(t);
    const el = element("src/app/page.tsx:12:5");

    press(...DEFAULT_COMBO);
    const { reached, prevented } = click(el);

    assert.equal(prevented, false);
    assert.equal(reached, true);
    assert.deepEqual(fetched, []);
  } finally {
    setNodeEnv("development");
  }
});
