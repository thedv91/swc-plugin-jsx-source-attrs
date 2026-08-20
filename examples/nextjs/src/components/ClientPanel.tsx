"use client";

import { useState } from "react";

// A client component hydrates, which is the only way a mismatch between the
// server tree and the client tree can surface. The inner element spreads the
// enclosing props on purpose: that shape is what broke under Turbopack, since
// the two pipelines disagreed about whether to annotate it.
export function ClientPanel({
  children,
  ...props
}: React.ComponentProps<"div">) {
  const [open, setOpen] = useState(false);

  return (
    <div {...props} className="rounded border p-4">
      <button onClick={() => setOpen((value) => !value)}>
        {open ? "hide" : "show"}
      </button>
      {open ? <p>{children}</p> : null}
    </div>
  );
}
