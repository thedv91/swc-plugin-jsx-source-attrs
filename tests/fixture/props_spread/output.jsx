function Passthrough(props) {
    return <div data-source-path="src/props_spread.jsx" {...props}/>;
}
function Rest({ children, ...rest }) {
    return <section data-source-path="src/props_spread.jsx" {...rest}>{children}</section>;
}
function Unrelated(props) {
    return <article data-source-path="src/props_spread.jsx" {...somethingElse}/>;
}
