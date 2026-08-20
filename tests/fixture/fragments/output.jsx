import React from 'react';
function Shell() {
    return <>
      <Fragment>
        <span data-source-path="src/fragments.jsx">shorthand and named fragments carry no host node</span>
      </Fragment>
      <React.Fragment>
        <em data-source-path="src/fragments.jsx">nor does the member expression form</em>
      </React.Fragment>
    </>;
}
