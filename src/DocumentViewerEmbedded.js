export default class DocumentViewerEmbedded {
  // container, access_token, baseURL, documentId
  constructor(container, options) {
    this.container = container;
    this.headers = options.headers;
    this.headers["Content-Type"] = "application/json";
    this.baseURL = options.baseURL;

    this.pageNumber = options.pageNumber;

    this.prefetchPages = 2; // prefetch this many pages in forward and backward directions
    this.offsetHeight = 0;
    this.lastScrollUpdate = performance.now();
    this.scrollUpdateInterval = 100; // msec

    // mouse event info
    this.dragging = false;
    this.dragStartPos = null;
    this.dragEndPos = null;

    this.drawWordOverlay = true;
    this.drawLineOverlay = false;
    this.drawBlockOverlay = true;

    this.pages = [];

    this.highlightRanges = [];
    if (options.highlightRanges && options.highlightRanges.length > 0) {
      this.setHighlightRanges(options.highlightRanges);
    }

    this.listeners = {};
    this.onChangePageNumber =
      options.onChangePageNumber || ((pageNumber) => {});

    // DOM elements
    this.toolbarContainer = DocumentViewerEmbedded.createElement("div", {
      className: "toolbarContainer",
      parent: this.container,
      style: {
        position: "relative",
        height: "28px",
        lineHeight: "28px",
        background: "#fafafa",
        borderBottom: "1px solid #eee",
        overflow: "hidden",
        fontSize: "12px",
        zIndex: "100",
        boxShadow: "0 5px 15px -10px rgba(0,0,0,0.25)",
      },
    });
    this.documentContainer = DocumentViewerEmbedded.createElement("div", {
      className: "documentContainer",
      parent: this.container,
      eventListeners: {
        scroll: () => {
          this.scrollHandler();
        },
        mousemove: (event) => {
          this.mouseHandler(event, "mousemove");
        },
        mousedown: (event) => {
          this.mouseHandler(event, "mousedown");
        },
        mouseup: (event) => {
          this.mouseHandler(event, "mouseup");
        },
        resize: (event) => {
          this.resizeHandler(event);
        },
      },
      style: {
        position: "relative",
        height: "calc(100% - 30px)",
        background: "#fff",
        overflowY: "auto",
        transition: "background 0.5s",
      },
    });
    this.pagesContainer = DocumentViewerEmbedded.createElement("div", {
      className: "pagesContainer",
      parent: this.documentContainer,
      style: {
        width: "60rem",
        maxWidth: "calc(100% - 2rem)",
        position: "relative",
        margin: "1rem auto",
        opacity: "0",
        transition: "opacity 0.25s",
      },
    });
    this.dragOverlay = DocumentViewerEmbedded.createElement("div", {
      clasName: "dragOverlay",
      parent: this.documentContainer,
      style: {
        position: "absolute",
        zIndex: 1000,
        background: "rgba(0,190,255,0.2)",
        border: "1px solid rgba(0,190,255,0.4)",
        transition: "opacity 0.25s",
        pointerEvents: "none",
        whiteSpace: "pre",
      },
    });
    this.setDocumentId(options.documentId);
  }

  setHighlightRanges(ranges) {
    if (JSON.stringify(ranges) === JSON.stringify(this.highlightRanges)) {
      return;
    }
    this.highlightRanges = [...ranges];
    // repaint text layers for pages that are active
    for (const page of this.pages) {
      if (page.active) {
        page.repaintTextLayer();
      }
    }
    // jump to location of first highlight range
    if (this.highlightRanges.length > 0) {
      this.jumpToLocation(this.highlightRanges[0].start);
    }
  }

  detach() {
    // called by componentWillUnmount
  }

  update(options) {
    if (options.pageNumber && options.pageNumber !== this.pageNumber) {
      this.setPageNumber(options.pageNumber, true);
    }
    if (Array.isArray(options.highlightRanges)) {
      this.setHighlightRanges(options.highlightRanges);
    }
  }

  on(event, listener) {
    // attach external event listeners
    this.listeners[event] = listener;
  }

  async setDocumentId(documentId) {
    this.documentId = documentId;
    Promise.all([
      fetch(`${this.baseURL}/api/document/${documentId}`, {
        method: "GET",
        headers: this.headers,
      }),
      fetch(`${this.baseURL}/api/document/${documentId}/layout`, {
        method: "GET",
        headers: this.headers,
      }),
    ]).then(async (responses) => {
      this.document = await responses[0].json();
      this.layout = await responses[1].json();
      this.createToolbar();
      this.createPages();
      this.pagesContainer.style.opacity = 1;
      window.setTimeout(() => {
        this.documentContainer.style.backgroundColor = "#aaa";
      }, 125);
      this.setPageNumber(this.pageNumber, true);
      this.scrollHandler();
    });
  }

  createToolbar() {
    this.toolbarTitle = DocumentViewerEmbedded.createElement("div", {
      className: "documentTitle",
      parent: this.toolbarContainer,
      textContent: this.document.meta.title || this.document.filename,
      style: {
        width: "100%",
        textAlign: "center",
        fontWeight: "bold",
      },
    });
    this.toolbarPageContainer = DocumentViewerEmbedded.createElement("div", {
      className: "documentPageCount",
      parent: this.toolbarContainer,
      style: {
        padding: "0 6px",
        position: "absolute",
        top: "0",
        right: "0",
      },
    });
    this.toolbarPageLabel = DocumentViewerEmbedded.createElement("span", {
      className: "documentPageCount",
      parent: this.toolbarPageContainer,
    });
    this.updateToolbarPageNumber();
  }

  updateToolbarPageNumber() {
    this.toolbarPageLabel.textContent = `${this.pageNumber} / ${this.layout.length}`;
  }

  createPages() {
    this.pages = this.layout.map((pageLayout, pageIndex) => {
      return new DocumentViewerEmbeddedPage(this, pageLayout, pageIndex);
    });
    for (const [, page] of this.pages.entries()) {
      this.pagesContainer.appendChild(page.container);
    }
    this.resizeHandler();
  }

  // Sets current page to that which has the greatest overlap amount
  scrollHandler() {
    const elapsed = performance.now() - this.lastScrollUpdate; // in ms
    if (elapsed < this.scrollUpdateInterval) {
      return;
    }

    // array whose elements are {pageNumber: 1, overlap: 0.85}
    const overlaps = [];
    const calculateOverlap = (v, p) => {
      return p.min > v.max || v.min > p.max
        ? 0
        : Math.min(v.max, p.max) - Math.max(v.min, p.min);
    };
    const viewportLimits = {
      min: this.documentContainer.scrollTop,
      max: this.documentContainer.scrollTop + this.offsetHeight,
    };

    let offsetTop = 0;
    for (const page of this.pages) {
      const pageLimits = {
        min: offsetTop,
        max: offsetTop + page.offsetHeight,
      };
      offsetTop += page.offsetHeight;
      let overlap = calculateOverlap(viewportLimits, pageLimits);
      if (overlap > 0) {
        overlaps.push({ pageNumber: page.pageNumber, overlap: overlap });
      }
    }
    this.lastScrollUpdate = performance.now();
    if (overlaps.length > 0) {
      // set current page to that which has the greatest overlap amount
      overlaps.sort((a, b) => {
        return b.overlap - a.overlap;
      });
      this.setPageNumber(overlaps[0].pageNumber, false);
    }
  }

  // set current page and scroll page into view
  setPageNumber(pageNumber, scrollIntoView = true) {
    if (this.pageNumber === pageNumber && scrollIntoView === false) {
      return;
    }
    this.pageNumber = pageNumber;
    this.onChangePageNumber(pageNumber);
    for (let i = 1; i <= this.pages.length; i++) {
      if (
        this.pageNumber - this.prefetchPages <= i &&
        i <= this.pageNumber + this.prefetchPages
      ) {
        this.pages[i - 1].load();
      } else {
        this.pages[i - 1].unload();
      }
    }
    if (scrollIntoView) {
      this.pages[pageNumber - 1].container.scrollIntoView();
    }
    this.updateToolbarPageNumber();
  }

  resizeHandler(event) {
    // computing offsetHeight onscroll is very expensive since it causes a layer tree update
    // so we cache it onresize since it won't change otherwise
    this.offsetHeight = this.documentContainer.offsetHeight;
    for (const page of this.pages) {
      page.offsetHeight = page.container.offsetHeight;
    }
  }

  mouseHandler(event, eventType) {
    // prevent propagation
    event.preventDefault();
    // map clientX, clientY to pageNumber pageX, pageY
    const getPageCoords = (mouseEvent) => {
      const elements = document.elementsFromPoint(
        mouseEvent.clientX,
        mouseEvent.clientY
      );
      for (const element of elements) {
        if (element.className === "page") {
          return {
            pageNumber: parseInt(element.dataset.pageNumber, 10),
            pageX: mouseEvent.clientX - element.getBoundingClientRect().left,
            pageY: mouseEvent.clientY - element.getBoundingClientRect().top,
          };
        }
      }
      return { pageNumber: 0 };
    };
    if (eventType === "mousedown") {
      const pageCoords = getPageCoords(event);
      if (pageCoords.pageNumber > 0) {
        this.dragStartPos = pageCoords;
        this.dragStart();
      } else {
        this.dragStop();
      }
    } else if (eventType === "mouseup") {
      this.dragEndPos = getPageCoords(event);
      this.dragStop();
    } else if (this.dragging) {
      if (event.buttons === 1) {
        this.dragEndPos = getPageCoords(event);
        this.dragUpdate();
      } else {
        this.dragStop();
      }
    } else {
      // mouse move with no buttons depressed
    }
  }

  dragStart() {
    this.dragging = true;
    this.dragOverlay.style.opacity = 1;
  }

  dragStop() {
    this.dragging = false;
    this.dragOverlay.style.opacity = 0;
  }

  dragUpdate() {
    this.renderDragOverlay();
    for (
      let pageNumber = this.dragStartPos.pageNumber;
      pageNumber < this.dragEndPos.pageNumber;
      pageNumber++
    ) {
      // const page = this.pages[pageNumber - 1];
    }
  }

  renderDragOverlay() {
    if (
      this.dragStartPos.pageNumber === 0 ||
      this.dragEndPos.pageNumber === 0
    ) {
      // this.dragStop();
      return;
    }
    const containerRect = this.documentContainer.getBoundingClientRect();
    const pageCoordToContainerCoord = (pageNumber, pageX, pageY) => {
      const pageRect = this.pages[
        pageNumber - 1
      ].container.getBoundingClientRect();
      return {
        x: pageRect.left - containerRect.left + pageX,
        y: pageRect.top - containerRect.top + pageY,
      };
    };
    let a = pageCoordToContainerCoord(
      this.dragStartPos.pageNumber,
      this.dragStartPos.pageX,
      this.dragStartPos.pageY
    );
    let b = pageCoordToContainerCoord(
      this.dragEndPos.pageNumber,
      this.dragEndPos.pageX,
      this.dragEndPos.pageY
    );
    let startCoord = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
    };
    let endCoord = {
      x: Math.max(a.x, b.x),
      y: Math.max(a.y, b.y),
    };
    this.dragOverlay.style.top =
      this.documentContainer.scrollTop + startCoord.y + "px";
    this.dragOverlay.style.left = startCoord.x + "px";
    this.dragOverlay.style.width = endCoord.x - startCoord.x + "px";
    this.dragOverlay.style.height = endCoord.y - startCoord.y + "px";
  }

  getPageNumber(charIndex) {
    for (const page of this.pages) {
      if (page.span[0] <= charIndex && charIndex <= page.span[1]) {
        return page.pageNumber;
      }
    }
    console.warn(`charIndex ${charIndex} out of bounds in getPageNumber()`);
    return -1;
  }

  jumpToLocation(charIndex) {
    const pageNumber = this.getPageNumber(charIndex);
    console.log(`jumpToLocation`, charIndex, pageNumber);
    if (pageNumber < 1 || pageNumber > this.pages.length) {
      console.warn(`Invalid pageNumber`, pageNumber);
      return;
    }
    const page = this.pages[pageNumber - 1];
    if (page.layoutLoaded) {
      this.setPageNumber(pageNumber, true);
    } else {
      this.setPageNumber(pageNumber, true);
    }
  }

  shouldHighlight(index) {
    for (let i = 0; i < this.highlightRanges.length; i++) {
      const range = this.highlightRanges[i];
      if (range.start <= index && index <= range.end) {
        return true;
      }
    }
    return;
  }

  /*
  jumpToLocation(location) {
    if (typeof location == "number") {
      location = this.getLocation(location);
    }
    let page = this.pages[location.pageIndex];
    let line = page.lines[location.lineIndex];
    let fraction = line[0][1] / page.height; // bbox ymin
    this.documentContainer.scrollTop =
      page.container.offsetTop + (fraction - 0.2) * page.container.offsetHeight;
  }
  */

  static createElement(nodename, options) {
    let el = document.createElement(nodename);
    if (options.hasOwnProperty("className")) {
      el.className = options.className;
    }
    if (options.hasOwnProperty("style")) {
      for (const [key, val] of Object.entries(options.style)) {
        el.style[key] = val;
      }
    }
    if (options.hasOwnProperty("eventListeners")) {
      for (const [key, val] of Object.entries(options.eventListeners)) {
        el.addEventListener(key, val);
      }
    }
    if (options.hasOwnProperty("attributes")) {
      for (const [key, val] of Object.entries(options.attributes)) {
        el.setAttribute(key, val);
      }
    }
    if (options.hasOwnProperty("dataset")) {
      for (const [key, val] of Object.entries(options.dataset)) {
        el.dataset[key] = val;
      }
    }
    if (options.hasOwnProperty("textContent")) {
      el.textContent = options.textContent;
    }
    if (options.hasOwnProperty("innerHTML")) {
      el.innerHTML = options.innerHTML;
    }
    if (options.hasOwnProperty("parent")) {
      options.parent.appendChild(el);
    }
    return el;
  }
}

class DocumentViewerEmbeddedPage {
  constructor(viewer, pageLayout, pageIndex, options) {
    this.viewer = viewer;

    this.pageNumber = pageIndex + 1;
    this.width = parseFloat(pageLayout.width);
    this.height = parseFloat(pageLayout.height);

    this.layout = undefined;
    this.span = pageLayout.span;
    this.lines = pageLayout.line;

    this.active = false;
    this.loading = false;
    this.imageLoaded = false;
    this.layoutLoaded = false;
    this.textLayerRendered = false;

    this.blockOverlays = [];
    this.lineOverlays = [];
    this.wordOverlays = [];

    this.container = DocumentViewerEmbedded.createElement("div", {
      className: "page",
      style: {
        paddingTop: `${100 * (this.height / this.width)}%`,
        position: "relative",
        backgroundColor: "#fff",
        width: "100%",
        borderTop: "1px solid #eee",
        overflow: "hidden",
      },
      dataset: {
        pageNumber: this.pageNumber,
      },
    });
    this.offsetHeight = this.container.offsetHeight;

    this.loadingLayer = DocumentViewerEmbedded.createElement("div", {
      parent: this.container,
      className: "loadingLayer",
      style: {
        display: "none",
        width: "100%",
        height: "100%",
        position: "absolute",
        left: "0",
        right: "0",
      },
    });
  }

  unload() {
    this.active = false;
    if (this.textLayerRendered) {
      this.blockOverlays = [];
      this.lineOverlays = [];
      this.wordOverlays = [];
      this.textLayer.remove();
      this.textLayerRendered = false;
    }
  }

  repaintTextLayer() {
    if (this.textLayer) {
      this.textLayer.remove();
    }
    this.textLayerRendered = false;
    this.load();
  }

  // this is called when the page enters the viewport and loads page layout and image asynchronously
  load() {
    this.active = true;

    if (this.loading) {
      return;
    }

    if (this.layoutLoaded && !this.textLayerRendered) {
      this.renderTextLayer();
    }

    if (this.textLayerRendered) {
      this.renderOverlays();
    }

    if (this.layoutLoaded || this.imageLoaded) {
      return;
    }

    this.loading = true;
    this.loadingLayer.style.display = "block";

    this.image = DocumentViewerEmbedded.createElement("img", {
      parent: this.container,
      className: "pageImage",
      style: {
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
      },
      attributes: { draggable: false },
      eventListeners: {
        load: () => {
          this.imageLoaded = true;
          this.loadingLayer.style.display = "none";
          if (this.imageLoaded && this.layoutLoaded) {
            this.loading = false;
          }
        },
      },
    });
    this.image.src = `${this.viewer.baseURL}/api/document/${this.viewer.documentId}/page/${this.pageNumber}/image`;

    fetch(
      `${this.viewer.baseURL}/api/document/${this.viewer.documentId}/page/${this.pageNumber}/layout`,
      { method: "GET", headers: this.viewer.headers }
    )
      .then((response) => response.json())
      .then((data) => {
        const layout = {
          width: data[0],
          height: data[1],
          span: data[3],
          blocks: [],
        };
        const convertBbox = (arr) => ({
          x1: arr[0],
          y1: arr[1],
          x2: arr[2],
          y2: arr[3],
        });
        data[2].forEach((blockArr, blockIndex) => {
          const block = {
            bbox: convertBbox(blockArr[0]),
            lines: [],
            span: blockArr[2],
          };
          blockArr[1].forEach((lineArr, lineIndex) => {
            const line = {
              bbox: convertBbox(lineArr[0]),
              words: [],
              span: lineArr[2],
            };
            lineArr[1].forEach((wordArr, wordIndex) => {
              line.words.push({
                bbox: convertBbox(wordArr[0]),
                text: wordArr[1],
                span: wordArr[2],
              });
            });
            block.lines.push(line);
          });
          layout.blocks.push(block);
        });
        this.layout = layout;
        this.layoutLoaded = true;
        if (this.imageLoaded && this.layoutLoaded) {
          this.loading = false;
        }
        this.renderTextLayer();
        this.renderOverlays();
      });
  }

  renderTextLayer() {
    if (this.textLayerRendered) {
      return;
    }
    this.blockOverlays = [];
    this.lineOverlays = [];
    this.wordOverlays = [];
    let pageFragment = document.createDocumentFragment();
    const textLayer = DocumentViewerEmbedded.createElement("div", {
      parent: pageFragment,
      className: "textLayer",
      style: {
        position: "absolute",
        pointerEvents: "none",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
      },
    });
    for (const [blockIndex, block] of this.layout.blocks.entries()) {
      if (this.viewer.drawBlockOverlay) {
        const blockOverlay = DocumentViewerEmbedded.createElement("div", {
          parent: textLayer,
          className: "blockOverlay",
          style: {
            position: "absolute",
            pointerEvents: "none",
            zIndex: 200,
            left: (block.bbox.x1 / this.layout.width) * 100 + "%",
            top: (block.bbox.y1 / this.layout.height) * 100 + "%",
            width:
              ((block.bbox.x2 - block.bbox.x1) / this.layout.width) * 100 + "%",
            height:
              ((block.bbox.y2 - block.bbox.y1) / this.layout.height) * 100 +
              "%",
          },
          dataset: {
            index: blockIndex,
            start: block.span[0],
            end: block.span[1],
          },
        });
        this.blockOverlays.push(blockOverlay);
      }
      for (const [lineIndex, line] of block.lines.entries()) {
        if (this.viewer.drawLineOverlay) {
          const lineOverlay = DocumentViewerEmbedded.createElement("div", {
            parent: textLayer,
            className: "lineOverlay",
            style: {
              position: "absolute",
              pointerEvents: "none",
              zIndex: 200,
              left: (line.bbox.x1 / this.layout.width) * 100 + "%",
              top: (line.bbox.y1 / this.layout.height) * 100 + "%",
              width:
                ((line.bbox.x2 - line.bbox.x1) / this.layout.width) * 100 + "%",
              height:
                ((line.bbox.y2 - line.bbox.y1) / this.layout.height) * 100 +
                "%",
            },
            dataset: {
              index: lineIndex,
              start: line.span[0],
              end: line.span[1],
            },
          });
          this.lineOverlays.push(lineOverlay);
        }
        for (const [wordIndex, word] of line.words.entries()) {
          if (this.viewer.drawWordOverlay) {
            const baseStyle = {
              position: "absolute",
              pointerEvents: "none",
              zIndex: 100,
              left: (word.bbox.x1 / this.layout.width) * 100 + "%",
              top: (word.bbox.y1 / this.layout.height) * 100 + "%",
              width:
                ((word.bbox.x2 - word.bbox.x1) / this.layout.width) * 100 + "%",
              height:
                ((word.bbox.y2 - word.bbox.y1) / this.layout.height) * 100 +
                "%",
            };
            let highlightStyle = {};
            if (this.viewer.shouldHighlight(word.span[0])) {
              highlightStyle = {
                backgroundColor: "#fea",
                outline: "4px solid #fea",
                mixBlendMode: "darken",
              };
            }
            const wordOverlay = DocumentViewerEmbedded.createElement("div", {
              parent: textLayer,
              className: "wordOverlay",
              style: { ...baseStyle, ...highlightStyle },
              dataset: {
                index: wordIndex,
                text: word.text,
                start: word.span[0],
                end: word.span[1],
              },
            });
            this.wordOverlays.push(wordOverlay);
          }
        }
      }
    }
    this.container.appendChild(pageFragment);
    this.textLayer = textLayer;
    this.textLayerRendered = true;
  }

  renderOverlays() {
    if (!this.textLayerRendered) {
      return;
    }
    /*
    let textLayer = this.container.querySelector(".textLayer");
    textLayer.querySelectorAll(".wordOverlay").forEach((wordOverlay) => {
      wordOverlay.classList.remove("highlighted");
      for (let i = 0; i < this.highlightRanges.length; i++) {
        let highlightRange = this.highlightRanges[i];
        if (
          highlightRange.start <= wordOverlay.dataset.start &&
          wordOverlay.dataset.start <= highlightRange.end
        ) {
          wordOverlay.classList.add("highlighted");
          wordOverlay.style.backgroundColor = highlightRange.color;
        }
      }
    });
    */
  }
}
