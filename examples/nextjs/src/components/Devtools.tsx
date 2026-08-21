"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

// The devtools shell reads `data-tsd-source` off the hovered element, so the
// plugin has to be configured to emit that name -- see `source-path-attr` in
// next.config.ts.
//
// `@tanstack/react-devtools` has no production guard of its own -- the Vite
// plugin's `removeDevtoolsOnBuild` is what normally strips it, and nothing does
// that job under Next. Imported statically it lands in the production bundle
// (measured: a 211 KB client chunk). Behind a `NODE_ENV` test the import is
// never reached, so the bundler drops it.
const TanStackDevtools =
  process.env.NODE_ENV === "development"
    ? dynamic(
        () =>
          import("@tanstack/react-devtools").then((m) => m.TanStackDevtools),
        { ssr: false },
      )
    : () => null;

// Mirrors the devtools' default `inspectHotkey`, `['Shift', 'Alt', 'CtrlOrMeta']`.
// Tracked from key events rather than read off the click, because a click
// synthesized without real modifier state carries none of these flags.
function isInspecting(held: Set<string>) {
  return (
    held.has("Shift") &&
    held.has("Alt") &&
    (held.has("Control") || held.has("Meta"))
  );
}

/**
 * Stops an inspect-click from also activating whatever was clicked.
 *
 * The devtools' own handler listens on `document` in the bubble phase, which is
 * after React has already dispatched `onClick` -- so inspecting a `<button>`
 * fires its handler, and a `<Link>` navigates, on the way to opening the file.
 * Their `preventDefault()` only cancels the browser's default action; anything
 * wired through React's synthetic events has run by then.
 *
 * Claiming the click in the capture phase does stop React, but it also stops
 * the event before it can reach the devtools listener -- verified: the file no
 * longer opens. So this takes the click over entirely and repeats the one
 * thing that handler does, reading the attribute the same way it does
 * (`elementFromPoint`, no ancestor walk) so what opens is what was highlighted.
 */
function useBlockInspectClicks() {
  useEffect(() => {
    // Without this the listeners would still be installed in production, where
    // Shift+Alt+Ctrl and a click would swallow the click for nothing.
    if (process.env.NODE_ENV !== "development") return;

    const held = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => held.add(e.key);
    const onKeyUp = (e: KeyboardEvent) => held.delete(e.key);
    // Modifiers released while the tab is unfocused never emit a keyup, which
    // would leave the blocker armed against ordinary clicks.
    const onBlur = () => held.clear();

    const onClick = (e: MouseEvent) => {
      if (!isInspecting(held)) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const source = el?.getAttribute("data-tsd-source");

      e.preventDefault();
      e.stopPropagation();

      if (!source) return;
      fetch(`/__tsd/open-source?source=${encodeURIComponent(source)}`).catch(
        () => {},
      );
    };

    addEventListener("keydown", onKeyDown, true);
    addEventListener("keyup", onKeyUp, true);
    addEventListener("blur", onBlur);
    document.addEventListener("click", onClick, true);

    return () => {
      removeEventListener("keydown", onKeyDown, true);
      removeEventListener("keyup", onKeyUp, true);
      removeEventListener("blur", onBlur);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}

export function Devtools() {
  useBlockInspectClicks();

  return <TanStackDevtools />;
}
