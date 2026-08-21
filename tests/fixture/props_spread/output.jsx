function Passthrough(props) {
    return <div data-tsd-source="src/props_spread.jsx" {...props}/>;
}
function Rest({ children, ...rest }) {
    return <section data-tsd-source="src/props_spread.jsx" {...rest}>{children}</section>;
}
function Unrelated(props) {
    return <article data-tsd-source="src/props_spread.jsx" {...somethingElse}/>;
}
