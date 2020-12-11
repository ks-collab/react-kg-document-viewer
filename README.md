## Usage

See example on [codesandbox.io](https://codesandbox.io/s/frosty-mendel-77zx6?file=/src/App.js)

**App.js**
```javascript
import React from "react";

import DocumentViewerReact from "react-kg-document-viewer";

const App = (props) => {
  let options = {
    headers: {
      Authorization: `Bearer ${props.token}`
    },
    baseURL: props.baseURL,
    documentId: 1,
    pageNumber: 1
  };
  return (
    <div className="App">
      <DocumentViewerReact options={options} />
    </div>
  );
};

export default App;
```
