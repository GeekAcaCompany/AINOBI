// SPDX-License-Identifier: AGPL-3.0-only
(function initRuntime() {
  var previewInit = null;
  var previewLoader = null;
  var SHAPE_NS = 'http://www.w3.org/2000/svg';
  var RUNTIME_PATCH_VERSION = 'shape-fallback-v39';

  /** Default fill when slide XML has no srgbClr on the shape. */
  var CALLOUT_FILL_HEX = '#EEF3E9';

  function n(value) {
    return Math.round(value * 100) / 100;
  }

  function decodeBase64ToArrayBuffer(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async function loadPreviewInit() {
    if (previewInit) return previewInit;
    if (!previewLoader) {
      previewLoader = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = '/runtime/vendor/pptx-preview.umd.js';
        script.onload = resolve;
        script.onerror = function () {
          reject(new Error('Failed to load /runtime/vendor/pptx-preview.umd.js'));
        };
        document.head.appendChild(script);
      });
    }
    await previewLoader;
    var mod = window.pptxPreview;
    if (!mod || typeof mod.init !== 'function') {
      throw new Error('pptx-preview runtime is not available');
    }
    previewInit = mod.init;
    return previewInit;
  }

  function createSvgNode(tagName, attrs) {
    var node = document.createElementNS(SHAPE_NS, tagName);
    var keys = Object.keys(attrs || {});
    for (var i = 0; i < keys.length; i += 1) {
      node.setAttribute(keys[i], String(attrs[keys[i]]));
    }
    return node;
  }

  function inferStrokeColor(container) {
    var sampled = container.querySelectorAll(
      'svg [stroke]:not([stroke="none"]):not([stroke="transparent"])'
    );
    for (var i = 0; i < sampled.length; i += 1) {
      var value = sampled[i].getAttribute('stroke');
      if (!value) continue;
      if (value.indexOf('url(') === 0) continue;
      if (value === 'currentColor') continue;
      if (value === 'rgba(255,0,0,1)' || value === 'rgb(255,0,0)') continue;
      return value;
    }
    return '#2f4054';
  }

  function drawFallbackShape(shapeEl, svgEl, styleContext) {
    var width = shapeEl.clientWidth || parseFloat(shapeEl.style.width) || 0;
    var height = shapeEl.clientHeight || parseFloat(shapeEl.style.height) || 0;
    if (width <= 0 || height <= 0) return false;

    var className = shapeEl.className || '';
    var strokeWidth = Math.max(1, Math.round(Math.min(width, height) * 0.015));
    var fill = 'none';
    var common = {
      stroke: styleContext.strokeColor,
      'stroke-width': strokeWidth,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      fill: fill,
    };

    if (className.indexOf('shape-wedgeRoundRectCallout') >= 0) {
      var strokeWAttr = parseFloat(shapeEl.getAttribute('data-pptx-stroke-width') || '');
      var lineW = !isNaN(strokeWAttr) ? Math.max(0.5, strokeWAttr) : 1;
      var strokeAttr = shapeEl.getAttribute('data-pptx-stroke');
      var calloutStroke = strokeAttr ? '#' + strokeAttr : styleContext.calloutStrokeColor;
      var fillAttr = shapeEl.getAttribute('data-pptx-fill');
      var calloutFill = fillAttr ? '#' + fillAttr : styleContext.calloutFillColor;
      var adj1 = parseInt(shapeEl.getAttribute('data-pptx-adj1') || '', 10);
      var adj2 = parseInt(shapeEl.getAttribute('data-pptx-adj2') || '', 10);
      var adj3 = parseInt(shapeEl.getAttribute('data-pptx-adj3') || '', 10);
      var adjOpts = {};
      if (!isNaN(adj1)) adjOpts.adj1 = adj1;
      if (!isNaN(adj2)) adjOpts.adj2 = adj2;
      if (!isNaN(adj3)) adjOpts.adj3 = adj3;
      var pathFn =
        window.PptxWedgeCallout && typeof window.PptxWedgeCallout.pathD === 'function'
          ? window.PptxWedgeCallout.pathD
          : null;
      if (!pathFn) {
        return false;
      }
      var dPath = pathFn(width, height, adjOpts);
      svgEl.appendChild(
        createSvgNode('path', {
          d: dPath,
          stroke: calloutStroke,
          'stroke-width': lineW,
          'stroke-linecap': common['stroke-linecap'],
          'stroke-linejoin': 'round',
          'stroke-miterlimit': '2',
          fill: calloutFill,
          'fill-rule': 'evenodd',
        })
      );
      return true;
    }

    if (className.indexOf('shape-wedgeRectCallout') >= 0) {
      var wrStrokeAttr = shapeEl.getAttribute('data-pptx-stroke');
      var wrStrokeWAttr = parseFloat(shapeEl.getAttribute('data-pptx-stroke-width') || '');
      var wrStroke = wrStrokeAttr ? '#' + wrStrokeAttr : common.stroke;
      var wrStrokeWidth = !isNaN(wrStrokeWAttr) ? Math.max(0.5, wrStrokeWAttr) : common['stroke-width'];
      var baseHalf = Math.max(8, Math.round(height * 0.12));
      var len = Math.max(12, Math.round(width * 0.03));
      var y = Math.round(height * 0.86);
      svgEl.appendChild(
        createSvgNode('rect', {
          x: strokeWidth / 2,
          y: strokeWidth / 2,
          width: width - strokeWidth,
          height: height - strokeWidth,
          stroke: wrStroke,
          'stroke-width': wrStrokeWidth,
          'stroke-linecap': common['stroke-linecap'],
          'stroke-linejoin': common['stroke-linejoin'],
          fill: common.fill,
        })
      );
      svgEl.appendChild(
        createSvgNode('polyline', {
          points:
            (width - strokeWidth) +
            ',' +
            Math.max(strokeWidth, y - baseHalf) +
            ' ' +
            (width + len) +
            ',' +
            y +
            ' ' +
            (width - strokeWidth) +
            ',' +
            Math.min(height - strokeWidth, y + baseHalf),
          stroke: wrStroke,
          'stroke-width': wrStrokeWidth,
          'stroke-linecap': common['stroke-linecap'],
          'stroke-linejoin': common['stroke-linejoin'],
          fill: 'none',
        })
      );
      return true;
    }

    if (className.indexOf('shape-wedgeEllipseCallout') >= 0) {
      var weStrokeAttr = shapeEl.getAttribute('data-pptx-stroke');
      var weStrokeWAttr = parseFloat(shapeEl.getAttribute('data-pptx-stroke-width') || '');
      var weStroke = weStrokeAttr ? '#' + weStrokeAttr : common.stroke;
      var weStrokeWidth = !isNaN(weStrokeWAttr) ? Math.max(0.5, weStrokeWAttr) : common['stroke-width'];
      var weFillAttr = shapeEl.getAttribute('data-pptx-fill');
      var weFill = weFillAttr ? '#' + weFillAttr : 'none';
      var adj1 = parseInt(shapeEl.getAttribute('data-pptx-adj1') || '', 10);
      var adj2 = parseInt(shapeEl.getAttribute('data-pptx-adj2') || '', 10);
      var dFn =
        window.PptxWedgeCallout && typeof window.PptxWedgeCallout.wedgeEllipsePathD === 'function'
          ? window.PptxWedgeCallout.wedgeEllipsePathD
          : null;
      if (!dFn) return false;
      var d = dFn(width, height, {
        adj1: !isNaN(adj1) ? adj1 : undefined,
        adj2: !isNaN(adj2) ? adj2 : undefined,
      });
      svgEl.appendChild(
        createSvgNode('path', {
          d: d,
          stroke: weStroke,
          'stroke-width': weStrokeWidth,
          'stroke-linecap': common['stroke-linecap'],
          'stroke-linejoin': common['stroke-linejoin'],
          'stroke-miterlimit': '2',
          fill: weFill,
          'fill-rule': 'evenodd',
        })
      );
      return true;
    }

    if (className.indexOf('shape-ellipse') >= 0) {
      svgEl.appendChild(
        createSvgNode('ellipse', {
          cx: width / 2,
          cy: height / 2,
          rx: Math.max(1, width / 2 - strokeWidth / 2),
          ry: Math.max(1, height / 2 - strokeWidth / 2),
          stroke: common.stroke,
          'stroke-width': common['stroke-width'],
          'stroke-linecap': common['stroke-linecap'],
          'stroke-linejoin': common['stroke-linejoin'],
          fill: common.fill,
        })
      );
      return true;
    }

    if (className.indexOf('shape-roundRect') >= 0) {
      var r = Math.max(8, Math.round(Math.min(width, height) * 0.12));
      svgEl.appendChild(
        createSvgNode('rect', {
          x: strokeWidth / 2,
          y: strokeWidth / 2,
          width: width - strokeWidth,
          height: height - strokeWidth,
          rx: r,
          ry: r,
          stroke: common.stroke,
          'stroke-width': common['stroke-width'],
          'stroke-linecap': common['stroke-linecap'],
          'stroke-linejoin': common['stroke-linejoin'],
          fill: common.fill,
        })
      );
      return true;
    }

    if (className.indexOf('shape-rect') >= 0) {
      svgEl.appendChild(
        createSvgNode('rect', {
          x: strokeWidth / 2,
          y: strokeWidth / 2,
          width: width - strokeWidth,
          height: height - strokeWidth,
          stroke: common.stroke,
          'stroke-width': common['stroke-width'],
          'stroke-linecap': common['stroke-linecap'],
          'stroke-linejoin': common['stroke-linejoin'],
          fill: common.fill,
        })
      );
      return true;
    }

    if (className.indexOf('shape-star5') >= 0) {
      var cxStar = width / 2;
      var cyStar = height / 2;
      var outerR = Math.max(1, Math.min(width, height) * 0.5 - strokeWidth / 2);
      var innerR = outerR * 0.382;
      var pts = [];
      var k;
      for (k = 0; k < 10; k += 1) {
        var ang = -Math.PI / 2 + (k * Math.PI) / 5;
        var rr = k % 2 === 0 ? outerR : innerR;
        pts.push(n(cxStar + rr * Math.cos(ang)) + ',' + n(cyStar + rr * Math.sin(ang)));
      }
      var starFillAttr = shapeEl.getAttribute('data-pptx-fill');
      var starStrokeAttr = shapeEl.getAttribute('data-pptx-stroke');
      var starStrokeWAttr = parseFloat(shapeEl.getAttribute('data-pptx-stroke-width') || '');
      var starFill = starFillAttr ? '#' + starFillAttr : '#FFFFFF';
      var starStroke = starStrokeAttr ? '#' + starStrokeAttr : 'none';
      var starStrokeW = !isNaN(starStrokeWAttr) ? Math.max(0, starStrokeWAttr) : 0;
      if (starStrokeW <= 0 || !starStrokeAttr) starStroke = 'none';
      svgEl.appendChild(
        createSvgNode('polygon', {
          points: pts.join(' '),
          fill: starFill,
          stroke: starStroke,
          'stroke-width': starStrokeW,
          'stroke-linecap': common['stroke-linecap'],
          'stroke-linejoin': common['stroke-linejoin'],
        })
      );
      return true;
    }

    return false;
  }

  function patchMissingSvgShapes(container) {
    var strokeColor = inferStrokeColor(container);
    var calloutFillColor = CALLOUT_FILL_HEX;
    var calloutStrokeColor = '#38536f';
    var shapes = container.querySelectorAll('[class*="shape-"]');
    for (var i = 0; i < shapes.length; i += 1) {
      var shape = shapes[i];
      var svg = shape.querySelector('svg');
      if (!svg) continue;
      var hasRealDrawing = svg.querySelector('path,rect,ellipse,polygon,polyline,line');
      if (hasRealDrawing) continue;
      drawFallbackShape(shape, svg, {
        strokeColor: strokeColor,
        calloutStrokeColor: calloutStrokeColor,
        calloutFillColor: calloutFillColor,
      });
    }
  }

  function patchWordArtTextEffects(container) {
    var shapes = container.querySelectorAll('.shape-wrapper[data-pptx-wordart-effect="1"]');
    var i;
    for (i = 0; i < shapes.length; i += 1) {
      var shape = shapes[i];
      var spans = shape.querySelectorAll('.text-wrapper span');
      if (!spans.length) continue;

      var glowColor = shape.getAttribute('data-pptx-glow-color');
      var glowRad = parseFloat(shape.getAttribute('data-pptx-glow-rad') || '');
      var glowAlpha = parseFloat(shape.getAttribute('data-pptx-glow-alpha') || '');
      var shadowColor = shape.getAttribute('data-pptx-shadow-color');
      var shadowBlur = parseFloat(shape.getAttribute('data-pptx-shadow-blur') || '');
      var shadowDist = parseFloat(shape.getAttribute('data-pptx-shadow-dist') || '');
      var shadowDir = parseFloat(shape.getAttribute('data-pptx-shadow-dir') || '');
      var shadowAlpha = parseFloat(shape.getAttribute('data-pptx-shadow-alpha') || '');
      var shadowSimple = shape.getAttribute('data-pptx-shadow-simple') !== '0';
      var reflBlur = parseFloat(shape.getAttribute('data-pptx-reflection-blur') || '');
      var reflStartA = parseFloat(shape.getAttribute('data-pptx-reflection-start-alpha') || '');
      var reflStartPos = parseFloat(shape.getAttribute('data-pptx-reflection-start-pos') || '');
      var reflEndA = parseFloat(shape.getAttribute('data-pptx-reflection-end-alpha') || '');
      var reflEndPos = parseFloat(shape.getAttribute('data-pptx-reflection-end-pos') || '');
      var reflDist = parseFloat(shape.getAttribute('data-pptx-reflection-dist') || '');
      var reflDir = parseFloat(shape.getAttribute('data-pptx-reflection-dir') || '');
      var reflSy = parseFloat(shape.getAttribute('data-pptx-reflection-sy') || '');

      var parts = [];
      if (glowColor && !isNaN(glowRad)) {
        var ga = !isNaN(glowAlpha) ? Math.max(0, Math.min(1, glowAlpha / 100000)) : 1;
        var gr = parseInt(glowColor.slice(0, 2), 16);
        var gg = parseInt(glowColor.slice(2, 4), 16);
        var gb = parseInt(glowColor.slice(4, 6), 16);
        // Office glow is visually denser than a single CSS shadow; keep the parsed
        // radius/alpha, but layer it to approximate DrawingML glow falloff.
        parts.push(
          '0 0 ' + n(Math.max(1.5, glowRad * 0.3)) + 'px rgba(' + gr + ',' + gg + ',' + gb + ',' + n(Math.min(1, ga * 1.15)) + ')'
        );
        parts.push('0 0 ' + n(glowRad * 0.75) + 'px rgba(' + gr + ',' + gg + ',' + gb + ',' + n(Math.min(1, ga * 1.25)) + ')');
        parts.push('0 0 ' + n(glowRad * 1.25) + 'px rgba(' + gr + ',' + gg + ',' + gb + ',' + n(Math.min(1, ga * 0.9)) + ')');
        parts.push(
          '0 0 ' + n(glowRad * 2.1) + 'px rgba(' + gr + ',' + gg + ',' + gb + ',' + n(ga * 0.45) + ')'
        );
      }
      if (shadowSimple && shadowColor && !isNaN(shadowDist)) {
        var sa = !isNaN(shadowAlpha) ? Math.max(0, Math.min(1, shadowAlpha / 100000)) : 1;
        var rad = !isNaN(shadowDir) ? (shadowDir / 60000) * (Math.PI / 180) : 0;
        var dx = shadowDist * Math.cos(rad);
        var dy = shadowDist * Math.sin(rad);
        var blur = !isNaN(shadowBlur) ? shadowBlur : 0;
        parts.push(
          n(dx) +
            'px ' +
            n(dy) +
            'px ' +
            n(blur) +
            'px rgba(' +
            parseInt(shadowColor.slice(0, 2), 16) +
            ',' +
            parseInt(shadowColor.slice(2, 4), 16) +
            ',' +
            parseInt(shadowColor.slice(4, 6), 16) +
            ',' +
            n(sa) +
            ')'
        );
      }
      if (!parts.length) continue;
      var si;
      for (si = 0; si < spans.length; si += 1) {
        spans[si].style.textShadow = parts.join(', ');
      }

      // Reflection layer (PPT reflection effect)
      var olds = shape.querySelectorAll('.text-wrapper[data-pptx-wordart-reflection="1"]');
      for (si = 0; si < olds.length; si += 1) olds[si].remove();
      if (!isNaN(reflStartA) && !isNaN(reflEndA) && !isNaN(reflEndPos)) {
        var src = shape.querySelector('.text-wrapper');
        if (src) {
          var clone = src.cloneNode(true);
          clone.setAttribute('data-pptx-wordart-reflection', '1');
          clone.style.pointerEvents = 'none';
          var top0 = parseFloat(src.style.top || '0') || 0;
          var srcH = src.getBoundingClientRect ? src.getBoundingClientRect().height : 0;
          if (!srcH || !isFinite(srcH)) srcH = shape.clientHeight || parseFloat(shape.style.height) || 0;
          var sy = !isNaN(reflSy) ? Math.abs(reflSy) / 100000 : 1;
          if (!isFinite(sy) || sy <= 0) sy = 1;
          var startPosFrac = Math.max(0, Math.min(1, (!isNaN(reflStartPos) ? reflStartPos : 0) / 100000));
          var endPosFrac = Math.max(0, Math.min(1, reflEndPos / 100000));
          var glyphBottom = srcH;
          var srcRect = src.getBoundingClientRect ? src.getBoundingClientRect() : null;
          var srcSpans = src.querySelectorAll('span');
          if (srcRect && srcSpans.length) {
            glyphBottom = 0;
            for (si = 0; si < srcSpans.length; si += 1) {
              var spanRect = srcSpans[si].getBoundingClientRect ? srcSpans[si].getBoundingClientRect() : null;
              if (spanRect) glyphBottom = Math.max(glyphBottom, spanRect.bottom - srcRect.top);
            }
            if (!glyphBottom || !isFinite(glyphBottom)) glyphBottom = srcH;
          }
          var visualGlyphBottom = top0 - srcH / 2 + glyphBottom;
          var distDy = 0;
          if (!isNaN(reflDist)) {
            var distRad = !isNaN(reflDir) ? (reflDir / 60000) * (Math.PI / 180) : Math.PI / 2;
            distDy = reflDist * Math.sin(distRad);
          }
          var fontSize = 0;
          if (srcSpans.length && window.getComputedStyle) {
            fontSize = parseFloat(window.getComputedStyle(srcSpans[0]).fontSize || '0') || 0;
          }
          var glyphInset = fontSize ? fontSize * 0.14 : Math.min(8, srcH * 0.11);
          // With transform-origin: bottom, a source-local y maps to
          // top + 2 * height - y. Align the mirrored glyph bottom to the
          // original glyph bottom, then apply the DrawingML distance. DOM text
          // bounds include font line-box descent; it affects both sides of the
          // mirror, so subtract it twice.
          clone.style.top = n(visualGlyphBottom + distDy - 2 * srcH + glyphBottom - 2 * glyphInset) + 'px';
          clone.style.transformOrigin = 'center bottom';
          clone.style.transform = 'scaleY(' + n(-sy) + ')';
          var a0 = Math.max(0, Math.min(1, reflStartA / 100000));
          var a1 = Math.max(0, Math.min(1, reflEndA / 100000));
          clone.style.opacity = String(a0);
          if (!isNaN(reflBlur) && reflBlur > 0) clone.style.filter = 'blur(' + n(reflBlur) + 'px)';
          clone.style.webkitMaskImage =
            'linear-gradient(to top, rgba(0,0,0,' +
            n(a0) +
            ') ' +
            n(startPosFrac * 100) +
            '%, rgba(0,0,0,' +
            n(a1) +
            ') ' +
            n(endPosFrac * 100) +
            '%, rgba(0,0,0,0) 100%)';
          clone.style.maskImage = clone.style.webkitMaskImage;
          shape.appendChild(clone);
        }
      }
    }
  }

  function patchTextWhitespace(container) {
    var textWrappers = container.querySelectorAll('.text-wrapper');
    var i;
    for (i = 0; i < textWrappers.length; i += 1) {
      textWrappers[i].style.whiteSpace = 'pre-wrap';
    }
  }

  function hasTextSpans(shape) {
    return shape.querySelector('.text-wrapper span') != null;
  }

  function applyBoldRunsToShape(shape, runs) {
    var spans = [].slice.call(shape.querySelectorAll('.text-wrapper:not([data-pptx-wordart-reflection="1"]) span'));
    if (!spans.length || !runs || !runs.length) return;

    var i;
    if (spans.length === runs.length) {
      for (i = 0; i < runs.length; i += 1) {
        if (runs[i].bold) spans[i].style.fontWeight = '700';
      }
      return;
    }

    var boldRanges = [];
    var cursor = 0;
    for (i = 0; i < runs.length; i += 1) {
      var len = (runs[i].text || '').length;
      if (runs[i].bold && len > 0) {
        boldRanges.push({ start: cursor, end: cursor + len });
      }
      cursor += len;
    }
    if (!boldRanges.length) return;

    var spanStart = 0;
    for (i = 0; i < spans.length; i += 1) {
      var spanText = spans[i].textContent || '';
      var spanEnd = spanStart + spanText.length;
      for (var j = 0; j < boldRanges.length; j += 1) {
        if (spanStart < boldRanges[j].end && spanEnd > boldRanges[j].start) {
          spans[i].style.fontWeight = '700';
          break;
        }
      }
      spanStart = spanEnd;
    }
  }

  function patchTextRunStyles(container, pptxIndex) {
    if (!pptxIndex || !pptxIndex.textBySlide) return;
    var wrappers = container.querySelectorAll('[class*="pptx-preview-slide-wrapper"]');
    var wi;
    for (wi = 0; wi < wrappers.length; wi += 1) {
      var wrap = wrappers[wi];
      var m = /pptx-preview-slide-wrapper-(\d+)/.exec(wrap.className);
      var slideIdx = m ? parseInt(m[1], 10) : wi;
      var entries = pptxIndex.textBySlide[slideIdx];
      if (!entries || !entries.length) continue;

      var shapes = [].slice.call(wrap.querySelectorAll('.slide-wrapper .shape-wrapper')).filter(hasTextSpans);
      if (!shapes.length) continue;

      var used = {};
      for (var ei = 0; ei < entries.length; ei += 1) {
        var entry = entries[ei];
        var best = -1;
        var bestScore = Infinity;
        for (var si = 0; si < shapes.length; si += 1) {
          if (used[si]) continue;
          var top = parseFloat(shapes[si].style.top) || 0;
          var left = parseFloat(shapes[si].style.left) || 0;
          var score = Math.abs(top - entry.py) + Math.abs(left - entry.px);
          if (score < bestScore) {
            bestScore = score;
            best = si;
          }
        }
        if (best < 0) continue;
        used[best] = true;
        applyBoldRunsToShape(shapes[best], entry.runs);
      }
    }
  }

  function applyPostRenderPatches(container, pptxIndex) {
    if (pptxIndex && window.PptxWedgeCallout && window.PptxWedgeCallout.applyDataAttributes) {
      window.PptxWedgeCallout.applyDataAttributes(container, pptxIndex);
    }
    patchMissingSvgShapes(container);
    patchTextWhitespace(container);
    patchTextRunStyles(container, pptxIndex);
    patchWordArtTextEffects(container);
  }

  async function convertPptxBase64(base64, options) {
    var resultEl = document.querySelector('#result');
    if (!resultEl) {
      throw new Error('Runtime target #result not found');
    }
    resultEl.innerHTML = '';
    try {
      var buf = decodeBase64ToArrayBuffer(base64);
      var pptxIndex = null;
      if (window.PptxWedgeCallout && typeof window.PptxWedgeCallout.extractIndex === 'function') {
        pptxIndex = await window.PptxWedgeCallout.extractIndex(buf);
      }
      var init = await loadPreviewInit();
      var previewer = window.PptxPreviewRenderHooks.install(init(resultEl, { width: 960, height: 540 }));
      if (options && options.allPages === true) {
        await previewer.load(buf);
        var pages = [];
        for (var pageIndex = 0; pageIndex < previewer.slideCount; pageIndex += 1) {
          await Promise.resolve(previewer.renderSingleSlide(pageIndex));
          applyPostRenderPatches(resultEl, pptxIndex);
          pages.push({
            page: pageIndex + 1,
            htmlId: 'slide_' + (pageIndex + 1),
            fragment: resultEl.innerHTML,
          });
        }
        return {
          slideCount: previewer.slideCount,
          pages: pages,
        };
      } else if (options && typeof options.page === 'number') {
        await previewer.load(buf);
        if (options.page > previewer.slideCount) {
          throw new Error('Page ' + options.page + ' exceeds slide count ' + previewer.slideCount);
        }
        await Promise.resolve(previewer.renderSingleSlide(options.page - 1));
      } else {
        await previewer.preview(buf);
      }
      applyPostRenderPatches(resultEl, pptxIndex);
      return resultEl.innerHTML;
    } catch (err) {
      var stack = err && err.stack ? err.stack : String(err);
      throw new Error('pptx-preview runtime error:\n' + stack);
    }
  }

  window.__runtimeReady = false;
  window.__runtimePatchVersion = RUNTIME_PATCH_VERSION;
  window.__convertPptxBase64 = convertPptxBase64;
  loadPreviewInit()
    .then(function () {
      window.__runtimeReady = true;
    })
    .catch(function (error) {
      console.error('Failed to initialize pptx-preview runtime:', error);
      window.__runtimeReady = false;
    });
})();
