import React from 'react';

function Shell() {
  return (
    <>
      <Fragment>
        <span>shorthand and named fragments carry no host node</span>
      </Fragment>
      <React.Fragment>
        <em>nor does the member expression form</em>
      </React.Fragment>
    </>
  );
}
