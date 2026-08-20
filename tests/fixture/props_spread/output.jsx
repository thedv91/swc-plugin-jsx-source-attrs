function Passthrough(props) {
    return <div {...props}/>;
}
function Rest({ children, ...rest }) {
    return <section {...rest}>{children}</section>;
}
function Unrelated(props) {
    return <article {...somethingElse} data-source-path="src/props_spread.jsx"/>;
}
