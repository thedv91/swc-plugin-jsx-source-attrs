"use client";

import { useBlockInspectClicks } from "@/hooks/useBlockInspectClicks";
import { TanStackDevtools } from "@tanstack/react-devtools";

export default function DevtoolsContent() {
  useBlockInspectClicks();

  return <TanStackDevtools />;
}
