"use client";

import dynamic from "next/dynamic";

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

export function Devtools() {
  return <TanStackDevtools />;
}
