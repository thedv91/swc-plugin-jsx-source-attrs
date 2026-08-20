// The element spreads the enclosing props, so the plugin leaves it alone --
// annotating here would overwrite whatever position the caller forwarded.
export function Spread(props: React.ComponentProps<"p">) {
  return <p {...props} />;
}
