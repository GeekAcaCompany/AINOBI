// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Corrections to what pptx-preview renders, applied from outside the library.
 *
 * pptx-preview is loaded as published. This file wraps the previewer's node renderer: it adjusts
 * the parsed node before the library draws it, and the element the library returns afterwards.
 */
(function initPreviewRenderHooks(global) {
  var BORDER_SIDES = ['left', 'right', 'top', 'bottom'];

  function noBorder() {
    return { width: 0, color: null };
  }

  /** A line with `a:noFill` is no line: do not let the theme's line style draw one. */
  function clearUnfilledShapeBorder(node) {
    if (!node.border || !node.source || !node.source['p:spPr']) return;
    var line = node.source['p:spPr']['a:ln'];
    if (line && line['a:noFill']) Object.assign(node.border, noBorder());
  }

  /** The library leaves a border side present but undefined when its line has `a:noFill`. */
  function clearUnfilledSides(border) {
    if (!border) return;
    var keys = Object.keys(border);
    for (var i = 0; i < keys.length; i += 1) {
      if (border[keys[i]] === undefined) border[keys[i]] = noBorder();
    }
  }

  function isTable(node) {
    return !!node.tableGrid && Array.isArray(node.tr);
  }

  function isPicture(node) {
    return !!(node.source && node.source['p:blipFill']) && !node.border;
  }

  function isContainer(node) {
    return Array.isArray(node.nodes);
  }

  function forEachCell(node, visit) {
    for (var r = 0; r < node.tr.length; r += 1) {
      var cells = (node.tr[r] && node.tr[r].td) || [];
      for (var c = 0; c < cells.length; c += 1) {
        if (cells[c]) visit(cells[c], r, c);
      }
    }
  }

  function prepareNode(node) {
    if (!node) return;
    clearUnfilledShapeBorder(node);
    if (isTable(node)) {
      forEachCell(node, function (cell) {
        clearUnfilledSides(cell.props && cell.props.border);
        clearUnfilledSides(cell.inheritTcStyle && cell.inheritTcStyle.border);
      });
    }
    if (isContainer(node)) {
      for (var i = 0; i < node.nodes.length; i += 1) prepareNode(node.nodes[i]);
    }
  }

  /** The width of a cell is the sum of the grid columns it spans. */
  function cellWidth(gridCol, index, props) {
    var span = props && props.gridSpan ? props.gridSpan : 1;
    var width = 0;
    for (var i = 0; i < span; i += 1) {
      var column = gridCol[index + i];
      width += column && column.width ? column.width : 0;
    }
    return width || 30;
  }

  function pictureTransform(node) {
    var parts = [];
    if (node.flipH) parts.push('scaleX(-1)');
    if (node.flipV) parts.push('scaleY(-1)');
    if (node.rotate) parts.push('rotate(' + node.rotate + 'deg)');
    return parts.join(' ');
  }

  function looksLikePicture(el) {
    var frame = !el.className && el.firstElementChild;
    return !!(frame && frame.firstElementChild && frame.firstElementChild.tagName === 'IMG');
  }

  /** Gives the picture its own box, so that its flip and rotation turn around its centre. */
  function finishPicture(node, el) {
    el.style.setProperty('width', node.extend.w + 'px');
    el.style.setProperty('height', node.extend.h + 'px');
    var transform = pictureTransform(node);
    if (transform) {
      el.style.setProperty('transform', transform);
      el.style.setProperty('transform-origin', 'center center');
    }
  }

  function finishTable(node, el) {
    var table = el.firstElementChild;
    if (!table || table.tagName !== 'TABLE') return;
    table.style.width = '100%';
    table.style.height = '100%';
    var gridCol = (node.tableGrid && node.tableGrid.gridCol) || [];
    var rows = table.children;
    var drawn = [];
    forEachCell(node, function (cell, r, c) {
      var props = cell.props || {};
      if (props.vMerge || props.hMerge) return;
      drawn[r] = drawn[r] || 0;
      var td = rows[r] && rows[r].children[drawn[r]];
      drawn[r] += 1;
      if (td) td.style.width = cellWidth(gridCol, c, props) + 'px';
    });
  }

  function pair(nodes, elements, isNode, isElement, visit) {
    var matchedNodes = nodes.filter(isNode);
    var matchedElements = [].slice.call(elements).filter(isElement);
    if (matchedNodes.length !== matchedElements.length) return;
    for (var i = 0; i < matchedNodes.length; i += 1) visit(matchedNodes[i], matchedElements[i]);
  }

  function isGroupElement(el) {
    return el.className === 'group';
  }

  function finishNode(node, el) {
    if (isTable(node)) {
      finishTable(node, el);
    } else if (isContainer(node)) {
      // Groups and diagrams draw their children themselves, in order.
      pair(node.nodes, el.children, isPicture, looksLikePicture, finishPicture);
      pair(node.nodes, el.children, isContainer, isGroupElement, finishNode);
    } else if (isPicture(node) && looksLikePicture(el)) {
      finishPicture(node, el);
    }
  }

  /** Lets the browser break lines between words rather than inside them. */
  function relaxParagraphBreaks(el) {
    var paragraphs = el.querySelectorAll('p');
    for (var i = 0; i < paragraphs.length; i += 1) {
      if (paragraphs[i].style.wordBreak === 'break-word') paragraphs[i].style.wordBreak = 'normal';
    }
  }

  function wrapRenderer(renderer) {
    if (!renderer || typeof renderer._renderNode !== 'function') {
      throw new Error('pptx-preview no longer exposes the node renderer these corrections wrap');
    }
    if (renderer._renderNode.__ainobiWrapped) return;
    var renderNode = renderer._renderNode;
    var wrapped = function (node) {
      prepareNode(node);
      var el = renderNode.apply(this, arguments);
      if (node && el) {
        finishNode(node, el);
        relaxParagraphBreaks(el);
      }
      return el;
    };
    wrapped.__ainobiWrapped = true;
    renderer._renderNode = wrapped;
  }

  /**
   * The previewer builds a new renderer each time it loads a file, so wrap each one as it is
   * assigned.
   */
  function install(previewer) {
    var renderer = previewer.htmlRender;
    if (renderer) wrapRenderer(renderer);
    Object.defineProperty(previewer, 'htmlRender', {
      configurable: true,
      enumerable: true,
      get: function () {
        return renderer;
      },
      set: function (value) {
        if (value) wrapRenderer(value);
        renderer = value;
      },
    });
    return previewer;
  }

  var api = {
    install: install,
    prepareNode: prepareNode,
    finishNode: finishNode,
    cellWidth: cellWidth,
    pictureTransform: pictureTransform,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.PptxPreviewRenderHooks = api;
})(typeof window !== 'undefined' ? window : globalThis);
