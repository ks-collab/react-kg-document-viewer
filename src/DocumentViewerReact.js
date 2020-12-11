import React from "react";
import PropTypes from "prop-types";
import DocumentViewerEmbedded from "./DocumentViewerEmbedded";

class DocumentViewerReact extends React.Component {
  componentWillUnmount() {
    if (this.documentViewer) {
      this.documentViewer.detach();
    }
  }
  componentDidMount() {
    this.updateDocumentViewer(this.props);
  }
  componentDidUpdate() {
    this.updateDocumentViewer(this.props);
  }
  updateDocumentViewer(props) {
    let options = props.options || {};
    if (this.documentViewer) {
      this.documentViewer.update(options);
    } else {
      this.documentViewer = new DocumentViewerEmbedded(
        this.documentViewerContainer,
        options
      );
    }
    return this.documentViewer;
  }
  render() {
    const { className, style } = this.props;
    return (
      <div
        ref={(ref) => {
          this.documentViewerContainer = ref;
        }}
        className={`${className || ""}`}
        style={{ ...style, height: "100%" }}
      ></div>
    );
  }
}

DocumentViewerReact.propTypes = {
  className: PropTypes.string,
  options: PropTypes.object,
  style: PropTypes.object
};

export default DocumentViewerReact;
