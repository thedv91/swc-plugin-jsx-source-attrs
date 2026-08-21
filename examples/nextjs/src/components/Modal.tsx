"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

// The shape every portal-based modal library ends up with: an overlay that
// closes on click, and content that stops the click from reaching it. React
// forwards `stopPropagation()` to the native event, which is what makes this
// interesting for the inspector -- see `useBlockInspectClicks` in Devtools.tsx.
export function Modal() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button className="underline" onClick={() => setOpen(true)}>
        open the modal
      </button>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 flex items-center justify-center bg-black/50"
              onClick={() => setOpen(false)}
            >
              <div
                className="rounded-lg bg-white p-6 text-black shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="mb-2 font-semibold">inside a portal</h3>
                <p className="text-sm">inspect this paragraph</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
