import { useEffect } from "react";

const DEFAULT_INSPECT_HOTKEY = ["Shift", "Alt", "CtrlOrMeta"];

// The hotkey is whatever the devtools' settings panel last wrote, so changing it
// there has to change it here too -- otherwise the blocker stays asleep while the
// inspector highlights, and the click dies in the first modal that stops
// propagation. Read per click rather than cached: the panel writes this key on
// every edit, with no reload in between.
function inspectHotkey(): string[] {
  try {
    const settings = localStorage.getItem("tanstack_devtools_settings");
    const keys = settings ? JSON.parse(settings).inspectHotkey : null;
    return Array.isArray(keys) && keys.length > 0 ? keys : DEFAULT_INSPECT_HOTKEY;
  } catch {
    return DEFAULT_INSPECT_HOTKEY;
  }
}

// Tracked from key events rather than read off the click, because a click
// synthesized without real modifier state carries none of these flags.
//
// Mirrors `isHotkeyCombinationPressed`: every key in the combo must be held and
// nothing beyond it, so a fourth key cancels the inspect just as it does for the
// devtools. `CtrlOrMeta` stands for either key, hence the two variants.
function isInspecting(held: Set<string>) {
  return ["CONTROL", "META"].some((either) => {
    const combo = inspectHotkey().map((key) => (key === "CtrlOrMeta" ? either : key.toUpperCase()));
    // `held` is a set of key names, so the two Shifts collapse into one entry
    // and holding both still matches a combo that asks for one.
    return combo.length === held.size && combo.every((key) => held.has(key));
  });
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
export function useBlockInspectClicks() {
  useEffect(() => {
    // Without this the listeners would still be installed in production, where
    // the hotkey and a click would swallow the click for nothing.
    if (process.env.NODE_ENV !== "development") return;

    const held = new Set<string>();

    // Folded to upper case on the way in, not at compare time: `e.key` is the
    // character the modifiers produce, so `Shift`+`a` goes down as "A" and, if
    // Shift is released first, comes back up as "a" -- which would not delete
    // the "A" that went in, and the leftover key disarms the blocker for good.
    // Upstream folds case in the same place, for the same reason.
    //
    // `e.key` is not always a string (a `<datalist>` pick reports none), and
    // such an event has to be dropped rather than recorded under some stand-in
    // name -- an entry nothing will ever release disarms the blocker for good.
    const nameOf = (e: KeyboardEvent) => (typeof e.key === "string" ? e.key.toUpperCase() : null);

    const onKeyDown = (e: KeyboardEvent) => {
      const key = nameOf(e);
      if (key !== null) held.add(key);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = nameOf(e);
      if (key === null) return;
      // macOS delivers no keyup for the keys held alongside Meta -- only Meta's
      // own arrives -- so releasing it has to drop everything, or the rest stays
      // held forever. `@solid-primitives/keyboard`, which is what the devtools
      // tracks with, does the same:
      // https://github.com/solidjs-community/solid-primitives/issues/269
      if (key === "META") held.clear();
      else held.delete(key);
    };

    // Neither an unfocused tab nor an open context menu emits the keyups for
    // what was held, which would leave the blocker armed against ordinary
    // clicks -- again matching what the devtools' own key tracking clears on.
    const onBlur = () => held.clear();
    const onContextMenu = (e: MouseEvent) => {
      if (!e.defaultPrevented) held.clear();
    };

    const onClick = (e: MouseEvent) => {
      if (!isInspecting(held)) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const source = el?.getAttribute("data-tsd-source");

      e.preventDefault();
      e.stopPropagation();

      if (!source) return;
      // Straight to Next's dev overlay, skipping the `/__tsd/open-source`
      // redirects. It reads `file`, `line1` and `column1` as separate params and
      // answers 400 to the packed one the devtools would send, so the split
      // happens here. Positionless is the live case, not a guard: a Client
      // Component under the React Compiler emits the bare path.
      const at = /^(.*):(\d+):(\d+)$/.exec(source);
      const file = at?.[1];
      const line1 = at?.[2];
      const column1 = at?.[3];
      const params =
        file != null && line1 != null && column1 != null
          ? new URLSearchParams({ file, line1, column1 })
          : new URLSearchParams({ file: source });
      fetch(`/__nextjs_launch-editor?${params}`).catch(() => {
        //
      });
    };

    addEventListener("keydown", onKeyDown, { capture: true });
    addEventListener("keyup", onKeyUp, { capture: true });
    addEventListener("blur", onBlur);
    addEventListener("contextmenu", onContextMenu);
    document.addEventListener("click", onClick, { capture: true });

    return () => {
      removeEventListener("keydown", onKeyDown, { capture: true });
      removeEventListener("keyup", onKeyUp, { capture: true });
      removeEventListener("blur", onBlur);
      removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, []);
}
