"use client";

import dynamic from "next/dynamic";

const DevtoolsContent = dynamic(() => import("./content"), {
  ssr: false,
});

export default function Devtools() {
  return process.env.NODE_ENV === "development" ? <DevtoolsContent /> : null;
}
