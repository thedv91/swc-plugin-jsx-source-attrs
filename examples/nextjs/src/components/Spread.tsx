// The plugin does annotate this element, but it inserts the attribute *before*
// the spread, so `{...props}` overwrites it and the caller's position wins.
// The markup ends up carrying `page.tsx`, never `Spread.tsx`.
export function Spread(props: React.ComponentProps<"p">) {
  return <p {...props} />;
}
