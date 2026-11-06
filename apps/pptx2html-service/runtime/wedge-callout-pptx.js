// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Extract callout geometry/style (round-rect + ellipse) from OOXML and
 * annotate preview DOM so runtime fallbacks can draw with PPT-consistent params.
 */
(function initWedgeCalloutPptx(global) {
  var LAYOUT_W = 1440;
  var LAYOUT_H = 810;

  function n(v) {
    return Math.round(v * 100) / 100;
  }

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  function toRad(angleUnits) {
    // OOXML angles are in 60000ths of a degree.
    return (angleUnits / 60000) * (Math.PI / 180);
  }

  function at2Units(x, y) {
    // Returns angle in OOXML units (60000ths of a degree), using SVG coordinate system (y down).
    return (Math.atan2(y, x) * 180) / Math.PI * 60000;
  }

  function wedgeEllipsePathD(width, height, opts) {
    opts = opts || {};
    var adj1 = typeof opts.adj1 === 'number' ? opts.adj1 : -20833;
    var adj2 = typeof opts.adj2 === 'number' ? opts.adj2 : 62500;

    var hc = width / 2;
    var vc = height / 2;
    var wd2 = hc;
    var hd2 = vc;

    var dxPos = (width * adj1) / 100000;
    var dyPos = (height * adj2) / 100000;
    var xPos = hc + dxPos;
    var yPos = vc + dyPos;

    // If tip is inside ellipse, PPT visually becomes "just an ellipse".
    var eq =
      wd2 > 0 && hd2 > 0
        ? ((xPos - hc) / wd2) * ((xPos - hc) / wd2) + ((yPos - vc) / hd2) * ((yPos - vc) / hd2)
        : 999;
    if (eq <= 1.00001) {
      // Two-arc ellipse path.
      var rx = Math.max(1e-6, wd2);
      var ry = Math.max(1e-6, hd2);
      return (
        'M ' +
        n(hc + rx) +
        ' ' +
        n(vc) +
        ' A ' +
        n(rx) +
        ' ' +
        n(ry) +
        ' 0 1 1 ' +
        n(hc - rx) +
        ' ' +
        n(vc) +
        ' A ' +
        n(rx) +
        ' ' +
        n(ry) +
        ' 0 1 1 ' +
        n(hc + rx) +
        ' ' +
        n(vc) +
        ' Z'
      );
    }

    // Follow DrawingML preset geometry for wedgeEllipseCallout.
    var sdx = dxPos * height;
    var sdy = dyPos * width;
    var pang = at2Units(sdx, sdy);
    var stAng = pang + 660000;
    var enAng = pang - 660000;
    var stRad = toRad(stAng);
    var enRad = toRad(enAng);

    var x1 = hc + wd2 * Math.cos(stRad);
    var y1 = vc + hd2 * Math.sin(stRad);
    var x2 = hc + wd2 * Math.cos(enRad);
    var y2 = vc + hd2 * Math.sin(enRad);

    // Determine arc flags (clockwise sweep in y-down coords).
    var delta = enRad - stRad;
    while (delta < 0) delta += Math.PI * 2;
    while (delta >= Math.PI * 2) delta -= Math.PI * 2;
    var largeArc = delta > Math.PI ? 1 : 0;
    var sweep = 1;

    return (
      'M ' +
      n(xPos) +
      ' ' +
      n(yPos) +
      ' L ' +
      n(x1) +
      ' ' +
      n(y1) +
      ' A ' +
      n(wd2) +
      ' ' +
      n(hd2) +
      ' 0 ' +
      largeArc +
      ' ' +
      sweep +
      ' ' +
      n(x2) +
      ' ' +
      n(y2) +
      ' Z'
    );
  }

  function hexToRgb(hex) {
    if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  function rgbToHex(rgb) {
    function c(v) {
      var x = Math.max(0, Math.min(255, Math.round(v)));
      var s = x.toString(16).toUpperCase();
      return s.length === 1 ? '0' + s : s;
    }
    return c(rgb.r) + c(rgb.g) + c(rgb.b);
  }

  function applyShade(hex, shadeVal) {
    var rgb = hexToRgb(hex);
    if (!rgb) return hex;
    var f = clamp((shadeVal || 100000) / 100000, 0, 1);
    return rgbToHex({
      r: rgb.r * f,
      g: rgb.g * f,
      b: rgb.b * f,
    });
  }

  function parseThemeColors(themeXml) {
    var map = {};
    if (!themeXml) return map;
    var clrM = /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(themeXml);
    if (!clrM) return map;
    var keys = [
      'dk1',
      'lt1',
      'dk2',
      'lt2',
      'accent1',
      'accent2',
      'accent3',
      'accent4',
      'accent5',
      'accent6',
      'hlink',
      'folHlink',
    ];
    var i;
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      var re = new RegExp('<a:' + k + '>[\\s\\S]*?(?:<a:srgbClr val="([0-9A-Fa-f]{6})"|<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})")[\\s\\S]*?<\\/a:' + k + '>');
      var m = re.exec(clrM[0]);
      if (m) map[k] = (m[1] || m[2] || '').toUpperCase();
    }
    return map;
  }

  function resolveSchemeClr(block, themeColors) {
    if (!block || !themeColors) return null;
    var sm = /<a:schemeClr val="([^"]+)"[^>]*>([\s\S]*?)<\/a:schemeClr>/.exec(block);
    if (!sm) {
      var smSelf = /<a:schemeClr val="([^"]+)"\s*\/>/.exec(block);
      if (!smSelf) return null;
      var keySelf = smSelf[1];
      // OOXML schemeClr aliases commonly used in slides
      // bg1/bg2/tx1/tx2 map onto lt1/lt2/dk1/dk2 in theme clrScheme.
      if (keySelf === 'bg1') keySelf = 'lt1';
      else if (keySelf === 'bg2') keySelf = 'lt2';
      else if (keySelf === 'tx1') keySelf = 'dk1';
      else if (keySelf === 'tx2') keySelf = 'dk2';
      var baseSelf = themeColors[keySelf];
      return baseSelf || null;
    }
    var key = sm[1];
    if (key === 'bg1') key = 'lt1';
    else if (key === 'bg2') key = 'lt2';
    else if (key === 'tx1') key = 'dk1';
    else if (key === 'tx2') key = 'dk2';
    var inner = sm[2] || '';
    var base = themeColors[key];
    if (!base) return null;
    var shadeM = /<a:shade val="(\d+)"/.exec(inner);
    if (shadeM) base = applyShade(base, parseInt(shadeM[1], 10));
    return base;
  }

  function resolveSolidFillHex(shapeXml, themeColors) {
    if (!shapeXml) return null;
    var solid = /<a:solidFill\b[^>]*>([\s\S]*?)<\/a:solidFill>/.exec(shapeXml);
    if (!solid) return null;
    var inner = solid[1] || '';
    var srgb = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(inner);
    if (srgb) return srgb[1].toUpperCase();
    var scheme = resolveSchemeClr(solid[0], themeColors);
    return scheme ? scheme.toUpperCase() : null;
  }

  function resolveColorHex(block, themeColors) {
    if (!block) return null;
    var srgb = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(block);
    if (srgb) return srgb[1].toUpperCase();
    var prst = /<a:prstClr val="([^"]+)"/.exec(block);
    if (prst) {
      var p = prst[1];
      if (p === 'black') return '000000';
      if (p === 'white') return 'FFFFFF';
      if (p === 'red') return 'FF0000';
      if (p === 'blue') return '0000FF';
      if (p === 'yellow') return 'FFFF00';
      if (p === 'green') return '00FF00';
    }
    var scheme = resolveSchemeClr(block, themeColors);
    return scheme ? scheme.toUpperCase() : null;
  }

  function parseAlpha(block) {
    var m = /<a:alpha val="(\d+)"/.exec(block || '');
    return m ? clamp(parseInt(m[1], 10), 0, 100000) : 100000;
  }

  function parseBoolAttr(attrs, name) {
    var re = new RegExp('\\b' + name + '="([^"]+)"');
    var m = re.exec(attrs || '');
    if (!m) return null;
    var v = String(m[1]).toLowerCase();
    if (v === '1' || v === 'true' || v === 'on') return true;
    if (v === '0' || v === 'false' || v === 'off') return false;
    return null;
  }

  function decodeXmlText(text) {
    return String(text || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function extractTextFromRun(runXml) {
    var parts = [];
    var tRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
    var tm;
    while ((tm = tRe.exec(runXml || ''))) {
      parts.push(decodeXmlText(tm[1]));
    }
    return parts.join('');
  }

  function extractParagraphDefaultBold(paragraphXml) {
    var pPr = /<a:pPr\b[\s\S]*?(?:<\/a:pPr>|\/>)/.exec(paragraphXml || '');
    if (!pPr) return null;
    var defRPr = /<a:defRPr\b([^>]*)/.exec(pPr[0]);
    return defRPr ? parseBoolAttr(defRPr[1], 'b') : null;
  }

  function extractTextRunsFromShape(shapeXml) {
    var runs = [];
    var pRe = /<a:p\b[\s\S]*?<\/a:p>/g;
    var pm;
    while ((pm = pRe.exec(shapeXml || ''))) {
      var paragraphXml = pm[0];
      var paragraphBold = extractParagraphDefaultBold(paragraphXml);
      var runRe = /<a:(r|fld)\b[\s\S]*?<\/a:\1>/g;
      var rm;
      while ((rm = runRe.exec(paragraphXml))) {
        var runXml = rm[0];
        var text = extractTextFromRun(runXml);
        if (!text) continue;
        var rPr = /<a:rPr\b([^>]*)/.exec(runXml);
        var bold = rPr ? parseBoolAttr(rPr[1], 'b') : null;
        if (bold == null) bold = paragraphBold;
        runs.push({
          text: text,
          bold: bold === true,
        });
      }
    }
    return runs;
  }

  function parseTextEffects(shapeXml, themeColors) {
    var m = /<a:effectLst>([\s\S]*?)<\/a:effectLst>/.exec(shapeXml || '');
    if (!m) return null;
    var effectXml = m[1];
    var out = {};

    var glowM = /<a:glow\b([^>]*)>([\s\S]*?)<\/a:glow>/.exec(effectXml);
    if (glowM) {
      var radM = /rad="(\d+)"/.exec(glowM[1] || '');
      var gColor = resolveColorHex(glowM[2], themeColors);
      if (gColor) out.glowColor = gColor;
      if (radM) out.glowRad = (parseInt(radM[1], 10) * 96) / 914400;
      out.glowAlpha = parseAlpha(glowM[2]);
    }

    var shM = /<a:outerShdw\b([^>]*)>([\s\S]*?)<\/a:outerShdw>/.exec(effectXml);
    if (shM) {
      var attrs = shM[1] || '';
      var inner = shM[2] || '';
      var blurM = /blurRad="(\d+)"/.exec(attrs);
      var distM = /dist="(\d+)"/.exec(attrs);
      var dirM = /dir="(-?\d+)"/.exec(attrs);
      var sColor = resolveColorHex(inner, themeColors);
      if (sColor) out.shadowColor = sColor;
      if (blurM) out.shadowBlur = (parseInt(blurM[1], 10) * 96) / 914400;
      if (distM) out.shadowDist = (parseInt(distM[1], 10) * 96) / 914400;
      if (dirM) out.shadowDir = parseInt(dirM[1], 10);
      out.shadowAlpha = parseAlpha(inner);
      var sxM = /sx="(-?\d+)"/.exec(attrs);
      var syM = /sy="(-?\d+)"/.exec(attrs);
      var kxM = /kx="(-?\d+)"/.exec(attrs);
      var kyM = /ky="(-?\d+)"/.exec(attrs);
      var sx = sxM ? parseInt(sxM[1], 10) : 100000;
      var sy = syM ? parseInt(syM[1], 10) : 100000;
      var kx = kxM ? parseInt(kxM[1], 10) : 0;
      var ky = kyM ? parseInt(kyM[1], 10) : 0;
      // Mark complex transformed shadows; CSS text-shadow cannot represent these 1:1.
      out.shadowSimple = sx === 100000 && sy === 100000 && kx === 0 && ky === 0;
    }

    var rfM = /<a:reflection\b([^>]*)\/>/.exec(effectXml);
    if (rfM) {
      var rAttrs = rfM[1] || '';
      var rBlurM = /blurRad="(\d+)"/.exec(rAttrs);
      var rStAM = /stA="(\d+)"/.exec(rAttrs);
      var rStPosM = /stPos="(\d+)"/.exec(rAttrs);
      var rEndAM = /endA="(\d+)"/.exec(rAttrs);
      var rEndPosM = /endPos="(\d+)"/.exec(rAttrs);
      var rDistM = /dist="(\d+)"/.exec(rAttrs);
      var rDirM = /dir="(-?\d+)"/.exec(rAttrs);
      var rSyM = /sy="(-?\d+)"/.exec(rAttrs);
      if (rBlurM) out.reflectionBlur = (parseInt(rBlurM[1], 10) * 96) / 914400;
      if (rStAM) out.reflectionStartAlpha = clamp(parseInt(rStAM[1], 10), 0, 100000);
      if (rStPosM) out.reflectionStartPos = clamp(parseInt(rStPosM[1], 10), 0, 100000);
      if (rEndAM) out.reflectionEndAlpha = clamp(parseInt(rEndAM[1], 10), 0, 100000);
      if (rEndPosM) out.reflectionEndPos = clamp(parseInt(rEndPosM[1], 10), 0, 100000);
      if (rDistM) out.reflectionDist = (parseInt(rDistM[1], 10) * 96) / 914400;
      if (rDirM) out.reflectionDir = parseInt(rDirM[1], 10);
      if (rSyM) out.reflectionSy = parseInt(rSyM[1], 10);
    }

    return Object.keys(out).length ? out : null;
  }

  /**
   * @param {number} width
   * @param {number} height
   * @param {{ adj1?: number, adj2?: number, adj3?: number }} [opts]
   */
  function pathD(width, height, opts) {
    opts = opts || {};
    var adj1 = typeof opts.adj1 === 'number' ? opts.adj1 : -20833;
    var adj2 = typeof opts.adj2 === 'number' ? opts.adj2 : 62500;
    var adj3 = typeof opts.adj3 === 'number' ? opts.adj3 : 16667;
    var l = 0;
    var t = 0;
    var r = width;
    var b = height;
    var hc = width / 2;
    var vc = height / 2;
    var ss = Math.min(width, height);

    // Follow DrawingML preset geometry math for wedgeRoundRectCallout.
    var dxPos = (width * adj1) / 100000;
    var dyPos = (height * adj2) / 100000;
    var xPos = hc + dxPos;
    var yPos = vc + dyPos;
    var dq = (dxPos * height) / Math.max(width, 1e-6);
    var ady = Math.abs(dyPos);
    var adq = Math.abs(dq);
    var dz = ady - adq;

    var xg1 = dxPos > 0 ? 7 : 2;
    var xg2 = dxPos > 0 ? 10 : 5;
    var x1 = (width * xg1) / 12;
    var x2 = (width * xg2) / 12;
    var yg1 = dyPos > 0 ? 7 : 2;
    var yg2 = dyPos > 0 ? 10 : 5;
    var y1 = (height * yg1) / 12;
    var y2 = (height * yg2) / 12;

    var t1 = dxPos > 0 ? l : xPos;
    var xl = dz > 0 ? l : t1;
    var t2 = dyPos > 0 ? x1 : xPos;
    var xt = dz > 0 ? t2 : x1;
    var t3 = dxPos > 0 ? xPos : r;
    var xr = dz > 0 ? r : t3;
    var t4 = dyPos > 0 ? xPos : x1;
    var xb = dz > 0 ? t4 : x1;
    var t5 = dxPos > 0 ? y1 : yPos;
    var yl = dz > 0 ? y1 : t5;
    var t6 = dyPos > 0 ? t : yPos;
    var yt = dz > 0 ? t6 : t;
    var t7 = dxPos > 0 ? yPos : y1;
    var yr = dz > 0 ? y1 : t7;
    var t8 = dyPos > 0 ? yPos : b;
    var yb = dz > 0 ? t8 : b;

    var u1 = clamp((ss * adj3) / 100000, 0, ss / 2);
    var u2 = r - u1;
    var v2 = b - u1;

    return (
      'M ' +
      n(l) +
      ' ' +
      n(u1) +
      ' A ' +
      n(u1) +
      ' ' +
      n(u1) +
      ' 0 0 1 ' +
      n(u1) +
      ' ' +
      n(t) +
      ' L ' +
      n(x1) +
      ' ' +
      n(t) +
      ' L ' +
      n(xt) +
      ' ' +
      n(yt) +
      ' L ' +
      n(x2) +
      ' ' +
      n(t) +
      ' L ' +
      n(u2) +
      ' ' +
      n(t) +
      ' A ' +
      n(u1) +
      ' ' +
      n(u1) +
      ' 0 0 1 ' +
      n(r) +
      ' ' +
      n(u1) +
      ' L ' +
      n(r) +
      ' ' +
      n(y1) +
      ' L ' +
      n(xr) +
      ' ' +
      n(yr) +
      ' L ' +
      n(r) +
      ' ' +
      n(y2) +
      ' L ' +
      n(r) +
      ' ' +
      n(v2) +
      ' A ' +
      n(u1) +
      ' ' +
      n(u1) +
      ' 0 0 1 ' +
      n(u2) +
      ' ' +
      n(b) +
      ' L ' +
      n(x2) +
      ' ' +
      n(b) +
      ' L ' +
      n(xb) +
      ' ' +
      n(yb) +
      ' L ' +
      n(x1) +
      ' ' +
      n(b) +
      ' L ' +
      n(u1) +
      ' ' +
      n(b) +
      ' A ' +
      n(u1) +
      ' ' +
      n(u1) +
      ' 0 0 1 ' +
      n(l) +
      ' ' +
      n(v2) +
      ' L ' +
      n(l) +
      ' ' +
      n(y2) +
      ' L ' +
      n(xl) +
      ' ' +
      n(yl) +
      ' L ' +
      n(l) +
      ' ' +
      n(y1) +
      ' Z'
    );
  }

  function parseThemeLineStyles(themeXml, themeColors) {
    var widths = {};
    var colors = {};
    if (!themeXml) return { widths: widths, colors: colors };
    var m = /<a:lnStyleLst>([\s\S]*?)<\/a:lnStyleLst>/.exec(themeXml);
    if (!m) return { widths: widths, colors: colors };
    var lnRe = /<a:ln\b[^>]*\bw="(\d+)"[^>]*>([\s\S]*?)<\/a:ln>/g;
    var lm;
    var idx = 1;
    while ((lm = lnRe.exec(m[1]))) {
      widths[idx] = parseInt(lm[1], 10);
      var c = null;
      var cSrgb = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(lm[2]);
      if (cSrgb) c = cSrgb[1].toUpperCase();
      if (!c) c = resolveSchemeClr(lm[2], themeColors);
      if (c) colors[idx] = c;
      idx += 1;
    }
    return { widths: widths, colors: colors };
  }

  function extractCalloutsFromSlideXml(xml, scaleX, scaleY, themeLineWidths, themeLineColors, themeColors) {
    var out = [];
    var re = /<p:sp\b[\s\S]*?<\/p:sp>/g;
    var block;
    while ((block = re.exec(xml))) {
      var b = block[0];
      var prstM = /<a:prstGeom prst="([^"]+)"/.exec(b);
      var prst = prstM ? prstM[1] : null;
      var shapeType = null;
      if (prst === 'wedgeRoundRectCallout' || prst === 'wedgeEllipseCallout' || prst === 'star5') {
        shapeType = prst;
      } else if (prst === 'rect' && b.indexOf('<a:effectLst>') >= 0 && b.indexOf('<p:txBody>') >= 0) {
        shapeType = 'wordartRect';
      } else {
        continue;
      }
      var offM = /<a:off x="(\d+)" y="(\d+)"/.exec(b);
      var extM = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(b);
      if (!offM || !extM) continue;
      var adj1 = 50000;
      var adj2 = 50000;
      var adj3 = 16667;
      var adjRe = /<a:gd name="adj(\d)" fmla="val (-?\d+)"/g;
      var am;
      while ((am = adjRe.exec(b))) {
        var vn = parseInt(am[1], 10);
        var vv = parseInt(am[2], 10);
        if (vn === 1) adj1 = vv;
        if (vn === 2) adj2 = vv;
        if (vn === 3) adj3 = vv;
      }
      var fillHex = resolveSolidFillHex(b, themeColors);
      var lnBlockM = /<a:ln\b[\s\S]*?<\/a:ln>/.exec(b);
      var lnNoFill = lnBlockM ? /<a:noFill\s*\/>/.test(lnBlockM[0]) : false;
      var strokeM = lnBlockM ? /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(lnBlockM[0]) : null;
      var strokeWm = lnBlockM ? /<a:ln\b[^>]*\bw="(\d+)"/.exec(lnBlockM[0]) : null;
      var lnRefIdxM = /<a:lnRef\b[^>]*\bidx="(\d+)"/.exec(b);
      var lnRefIdx = lnRefIdxM ? parseInt(lnRefIdxM[1], 10) : NaN;
      var strokeWEmu = strokeWm ? parseInt(strokeWm[1], 10) : NaN;
      if (isNaN(strokeWEmu) && !isNaN(lnRefIdx) && themeLineWidths && themeLineWidths[lnRefIdx]) {
        strokeWEmu = themeLineWidths[lnRefIdx];
      }
      var strokeHex = strokeM ? strokeM[1].toUpperCase() : null;
      if (!strokeHex && lnBlockM && !lnNoFill) strokeHex = resolveSchemeClr(lnBlockM[0], themeColors);
      if (!strokeHex && !lnNoFill && !isNaN(lnRefIdx) && themeLineColors && themeLineColors[lnRefIdx]) {
        strokeHex = themeLineColors[lnRefIdx];
      }
      if (!strokeHex && !lnNoFill) {
        var lnRefBlock = /<a:lnRef\b[\s\S]*?<\/a:lnRef>/.exec(b);
        if (lnRefBlock) strokeHex = resolveSchemeClr(lnRefBlock[0], themeColors);
      }
      if (lnNoFill) {
        strokeHex = null;
        strokeWEmu = 0;
      }
      var ox = parseInt(offM[1], 10);
      var oy = parseInt(offM[2], 10);
      var textFx = parseTextEffects(b, themeColors);
      out.push({
        shapeType: shapeType,
        px: ox * scaleX,
        py: oy * scaleY,
        adj1: adj1,
        adj2: adj2,
        adj3: adj3,
        fillHex: fillHex || null,
        strokeHex: strokeHex || null,
        strokeW: !isNaN(strokeWEmu) ? (strokeWEmu * 96) / 914400 : null,
        textFx: textFx,
      });
    }
    return out;
  }

  function extractTextRunsFromSlideXml(xml, scaleX, scaleY) {
    var out = [];
    var re = /<p:sp\b[\s\S]*?<\/p:sp>/g;
    var block;
    while ((block = re.exec(xml || ''))) {
      var b = block[0];
      if (b.indexOf('<p:txBody>') < 0) continue;
      var offM = /<a:off x="(\d+)" y="(\d+)"/.exec(b);
      var extM = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(b);
      if (!offM || !extM) continue;
      var runs = extractTextRunsFromShape(b);
      var hasBold = runs.some(function (run) {
        return run.bold;
      });
      if (!hasBold) continue;
      out.push({
        px: parseInt(offM[1], 10) * scaleX,
        py: parseInt(offM[2], 10) * scaleY,
        runs: runs,
      });
    }
    return out;
  }

  /**
   * JSZip 2.x (bundled vendor): `new JSZip(buf)` + `.asText()` — no `loadAsync`.
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<null | { slideCx: number, slideCy: number, layoutW: number, layoutH: number, bySlide: Array<Array<{shapeType:string,px:number,py:number,adj1:number,adj2:number,adj3:number,fillHex:string|null,strokeHex:string|null,strokeW:number|null,textFx?:object|null}>>, textBySlide: Array<Array<{px:number,py:number,runs:Array<{text:string,bold:boolean}>}>> }>}
   */
  async function extractIndex(arrayBuffer) {
    if (!global.JSZip || !arrayBuffer) return null;
    try {
      var zip = new global.JSZip(arrayBuffer);
      var relsFile = zip.file('ppt/_rels/presentation.xml.rels');
      var presFile = zip.file('ppt/presentation.xml');
      if (!relsFile || !presFile) return null;
      var relsXml = relsFile.asText();
      var presXml = presFile.asText();

      var ridToTarget = {};
      var relRe = /<Relationship\b[^>]*\/>/g;
      var relMatch;
      while ((relMatch = relRe.exec(relsXml))) {
        var block = relMatch[0];
        var idMatch = /Id="([^"]+)"/.exec(block);
        var tgtMatch = /Target="([^"]+)"/.exec(block);
        if (!idMatch || !tgtMatch) continue;
        if (tgtMatch[1].indexOf('slides/slide') !== 0) continue;
        ridToTarget[idMatch[1]] = 'ppt/' + tgtMatch[1];
      }

      var slidePaths = [];
      var sldRe = /<p:sldId[^>]*r:id="([^"]+)"/g;
      var sm;
      while ((sm = sldRe.exec(presXml))) {
        var pth = ridToTarget[sm[1]];
        if (pth) slidePaths.push(pth);
      }

      var slideCx = 18288000;
      var slideCy = 10287000;
      var szM = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(presXml);
      if (szM) {
        slideCx = parseInt(szM[1], 10);
        slideCy = parseInt(szM[2], 10);
      }

      var scaleX = LAYOUT_W / slideCx;
      var scaleY = LAYOUT_H / slideCy;
      var themeLineWidths = {};
      var themeLineColors = {};
      var themeColors = {};
      var themeFile = zip.file('ppt/theme/theme1.xml');
      if (themeFile) {
        var themeXml = themeFile.asText();
        themeColors = parseThemeColors(themeXml);
        var lineStyles = parseThemeLineStyles(themeXml, themeColors);
        themeLineWidths = lineStyles.widths;
        themeLineColors = lineStyles.colors;
      }

      var bySlide = [];
      var textBySlide = [];
      var si;
      for (si = 0; si < slidePaths.length; si++) {
        var sf = zip.file(slidePaths[si]);
        if (!sf) {
          bySlide[si] = [];
          textBySlide[si] = [];
          continue;
        }
        var slideXml = sf.asText();
        bySlide[si] = extractCalloutsFromSlideXml(
          slideXml,
          scaleX,
          scaleY,
          themeLineWidths,
          themeLineColors,
          themeColors
        );
        textBySlide[si] = extractTextRunsFromSlideXml(slideXml, scaleX, scaleY);
      }

      return {
        slideCx: slideCx,
        slideCy: slideCy,
        layoutW: LAYOUT_W,
        layoutH: LAYOUT_H,
        bySlide: bySlide,
        textBySlide: textBySlide,
      };
    } catch (e) {
      return null;
    }
  }

  function cmpTopLeftShape(a, b) {
    var at = parseFloat(a.style.top) || 0;
    var bt = parseFloat(b.style.top) || 0;
    if (at !== bt) return at - bt;
    return (parseFloat(a.style.left) || 0) - (parseFloat(b.style.left) || 0);
  }

  function cmpTopLeftMetaFix(a, b) {
    if (a.py !== b.py) return a.py - b.py;
    return a.px - b.px;
  }

  function applyDataAttributes(container, pptxIndex) {
    if (!pptxIndex || !pptxIndex.bySlide) return;
    var wrappers = container.querySelectorAll('[class*="pptx-preview-slide-wrapper"]');
    var wi;
    for (wi = 0; wi < wrappers.length; wi++) {
      var wrap = wrappers[wi];
      var m = /pptx-preview-slide-wrapper-(\d+)/.exec(wrap.className);
      var slideIdx = m ? parseInt(m[1], 10) : wi;
      var entries = pptxIndex.bySlide[slideIdx];
      if (!entries || !entries.length) continue;

      function applyForType(selector, typeName, withAdj) {
        var typeEls = [].slice.call(wrap.querySelectorAll(selector));
        if (!typeEls.length) return;
        var typeEntries = entries.filter(function (e) {
          return e.shapeType === typeName;
        });
        if (!typeEntries.length) return;
        typeEls.sort(cmpTopLeftShape);
        var sortedE = typeEntries.slice().sort(cmpTopLeftMetaFix);
        var j;
        for (j = 0; j < typeEls.length && j < sortedE.length; j++) {
          var e = sortedE[j];
          if (withAdj) {
            typeEls[j].setAttribute('data-pptx-adj1', String(e.adj1));
            typeEls[j].setAttribute('data-pptx-adj2', String(e.adj2));
            typeEls[j].setAttribute('data-pptx-adj3', String(e.adj3));
          }
          if (e.fillHex) typeEls[j].setAttribute('data-pptx-fill', e.fillHex);
          if (e.strokeHex) typeEls[j].setAttribute('data-pptx-stroke', e.strokeHex);
          if (typeof e.strokeW === 'number' && isFinite(e.strokeW)) {
            typeEls[j].setAttribute('data-pptx-stroke-width', String(e.strokeW));
          }
        }
      }

      function applyByNearest(selector, typeName, withAdj) {
        var typeEls = [].slice.call(wrap.querySelectorAll(selector));
        if (!typeEls.length) return;
        var typeEntries = entries.filter(function (e) {
          return e.shapeType === typeName;
        });
        if (!typeEntries.length) return;
        var used = {};
        var ei;
        for (ei = 0; ei < typeEntries.length; ei++) {
          var e = typeEntries[ei];
          var best = -1;
          var bestScore = Infinity;
          var ii;
          for (ii = 0; ii < typeEls.length; ii++) {
            if (used[ii]) continue;
            var et = parseFloat(typeEls[ii].style.top) || 0;
            var el = parseFloat(typeEls[ii].style.left) || 0;
            var score = Math.abs(et - e.py) + Math.abs(el - e.px);
            if (score < bestScore) {
              bestScore = score;
              best = ii;
            }
          }
          if (best < 0) continue;
          used[best] = true;
          var target = typeEls[best];
          if (withAdj) {
            target.setAttribute('data-pptx-adj1', String(e.adj1));
            target.setAttribute('data-pptx-adj2', String(e.adj2));
            target.setAttribute('data-pptx-adj3', String(e.adj3));
          }
          if (e.fillHex) target.setAttribute('data-pptx-fill', e.fillHex);
          if (e.strokeHex) target.setAttribute('data-pptx-stroke', e.strokeHex);
          if (typeof e.strokeW === 'number' && isFinite(e.strokeW)) {
            target.setAttribute('data-pptx-stroke-width', String(e.strokeW));
          }
          if (e.textFx) {
            target.setAttribute('data-pptx-wordart-effect', '1');
            if (e.textFx.glowColor) target.setAttribute('data-pptx-glow-color', e.textFx.glowColor);
            if (typeof e.textFx.glowRad === 'number')
              target.setAttribute('data-pptx-glow-rad', String(e.textFx.glowRad));
            if (typeof e.textFx.glowAlpha === 'number')
              target.setAttribute('data-pptx-glow-alpha', String(e.textFx.glowAlpha));
            if (e.textFx.shadowColor) target.setAttribute('data-pptx-shadow-color', e.textFx.shadowColor);
            if (typeof e.textFx.shadowBlur === 'number')
              target.setAttribute('data-pptx-shadow-blur', String(e.textFx.shadowBlur));
            if (typeof e.textFx.shadowDist === 'number')
              target.setAttribute('data-pptx-shadow-dist', String(e.textFx.shadowDist));
            if (typeof e.textFx.shadowDir === 'number')
              target.setAttribute('data-pptx-shadow-dir', String(e.textFx.shadowDir));
            if (typeof e.textFx.shadowAlpha === 'number')
              target.setAttribute('data-pptx-shadow-alpha', String(e.textFx.shadowAlpha));
            if (typeof e.textFx.shadowSimple === 'boolean')
              target.setAttribute('data-pptx-shadow-simple', e.textFx.shadowSimple ? '1' : '0');
            if (typeof e.textFx.reflectionBlur === 'number')
              target.setAttribute('data-pptx-reflection-blur', String(e.textFx.reflectionBlur));
            if (typeof e.textFx.reflectionStartAlpha === 'number')
              target.setAttribute('data-pptx-reflection-start-alpha', String(e.textFx.reflectionStartAlpha));
            if (typeof e.textFx.reflectionStartPos === 'number')
              target.setAttribute('data-pptx-reflection-start-pos', String(e.textFx.reflectionStartPos));
            if (typeof e.textFx.reflectionEndAlpha === 'number')
              target.setAttribute('data-pptx-reflection-end-alpha', String(e.textFx.reflectionEndAlpha));
            if (typeof e.textFx.reflectionEndPos === 'number')
              target.setAttribute('data-pptx-reflection-end-pos', String(e.textFx.reflectionEndPos));
            if (typeof e.textFx.reflectionDist === 'number')
              target.setAttribute('data-pptx-reflection-dist', String(e.textFx.reflectionDist));
            if (typeof e.textFx.reflectionDir === 'number')
              target.setAttribute('data-pptx-reflection-dir', String(e.textFx.reflectionDir));
            if (typeof e.textFx.reflectionSy === 'number')
              target.setAttribute('data-pptx-reflection-sy', String(e.textFx.reflectionSy));
          }
        }
      }

      applyForType('.shape-wedgeRoundRectCallout', 'wedgeRoundRectCallout', true);
      applyForType('.shape-wedgeEllipseCallout', 'wedgeEllipseCallout', true);
      applyByNearest('.shape-star5', 'star5', false);
      applyByNearest('.shape-rect', 'wordartRect', false);
    }
  }

  global.PptxWedgeCallout = {
    pathD: pathD,
    wedgeEllipsePathD: wedgeEllipsePathD,
    extractIndex: extractIndex,
    applyDataAttributes: applyDataAttributes,
    LAYOUT_W: LAYOUT_W,
    LAYOUT_H: LAYOUT_H,
  };
})(typeof window !== 'undefined' ? window : globalThis);
