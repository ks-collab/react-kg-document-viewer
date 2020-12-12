## Usage

See interactive example on [codesandbox.io](https://codesandbox.io/s/frosty-mendel-77zx6?file=/src/App.js)

```javascript
import React, {useState} from "react";

import DocumentViewerReact from "react-kg-document-viewer";

const App = (props) => {
  const [pageNumber, setPageNumber] = useState(1);
  const [highlightRanges, setHighlightRanges] = useState([]);
  let options = {
    headers: {
      Authorization: `Bearer ${props.token}`,
    },
    baseURL: props.baseURL,
    documentId: props.documentId || 1,
    pageNumber: pageNumber,
    highlightRanges: highlightRanges, // array of {start: 1, end: 5}
    onChangePageNumber: (pageNumber_) => { // allow viewer to update pageNumber
      setPageNumber(pageNumber_);
    }
  };
  return (
    <div className="App">
      <DocumentViewerReact options={options} />
    </div>
  );
};

export default App;
```
