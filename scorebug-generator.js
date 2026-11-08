/* 棒球实时计分 · BAS 高级弹幕生成器 v2
 * 依据 https://bilibili.github.io/bas/#/guide 语法：def text / def path / set / then / duration
 * 同一份几何数据同时产出 BAS 脚本与 SVG 预览，保证预览与弹幕一致。
 *
 * v2 变化：
 *  1. 右下角原「四个大数字圆圈」模块取消，改成 B / S 上下两行独立记数（圆点 + 数字）。
 *  2. 队伍名称所在行的底色、文字色，以及上垒菱形高亮色均可在生成时自定义（默认上垒为纯白）。
 *  3. 位置模块支持左上 / 右上 / 左下 / 右下四种贴角预设，右下角会按宽度自动换算 Y，不越界。
 *  4. 右下角 B / S 两行底色统一为可配置的「球数行底色」（默认纯黑 #0B0B0C），空点统一暗灰。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ScorebugBAS = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var BOARD_W = 520, BOARD_H = 163;          // 计分条内部坐标（与参考图 520x163 一致）
  var STAGE_W = 1000, STAGE_H = 562.5;      // 16:9 播放器参考舞台

  var COLOR = {
    frame:       0xC9CBD2,
    bg:          0x0B0B0C,
    blue:        0x2C51C2,
    darkRight:   0x191B1F,
    line:        0xCBD1DC,
    midLine:     0x4A4C55,
    baseOff:     0x2B2C36,
    baseEdge:    0xC9CFD8,
    outOff:      0x3D3C47,
    ballOff:     0x585E6C,   // B / S 黑色行上的空点（统一暗灰，避免与点亮白点混淆）
    strikeOff:   0x585E6C,   // 好球行改黑底后与坏球行一致
    countOn:     0xFFFFFF,   // 球数点亮统一用纯白
    arrowOff:    0x55565F,
    arrowOn:     0xFFFFFF,
    white:       0xFFFFFF,
    blueWhite:   0xDCEBFF
  };

  var DEFAULT_STATE = {
    awayName: 'ARI', homeName: 'LAD',
    awayScore: 4, homeScore: 4,
    inning: 5, half: 'bottom',
    b1: 1, b2: 1, b3: 1,
    outs: 0, balls: 1, strikes: 2
  };

  var DEFAULT_OPTIONS = {
    widthPct: 52,
    xPct: 3,
    yPct: 4,
    anchor: 'br',        // custom | tl | tr | bl | br —— 默认贴右下角
    marginPct: 2,        // 贴角留白（占播放器百分比）
    duration: '2h',
    awayBg: '#0B0B0C',   // 客队名称行底色（可变色）
    awayFg: '#FFFFFF',   // 客队名称 / 比分文字色
    homeBg: '#2C51C2',   // 主队名称行底色（可变色）
    homeFg: '#FFFFFF',   // 主队名称 / 比分文字色
    countBg: '#0B0B0C',  // 右下角 B / S 球数行底色（两行统一，默认黑色）
    baseOn: '#FFFFFF',   // 上垒菱形高亮色（纯白更清楚）
    fontScale: 100,      // 全部文字字号百分比
    nameScoreScale: 100, // 队名 / 比分字号百分比（两位数比分防挤）
    autoFit: true        // 队名与比分超宽时自动缩小，留出间隙
  };

  var EVENT_FIELDS = [
    { key: 'awayName',  label: '客队名称', kind: 'text' },
    { key: 'homeName',  label: '主队名称', kind: 'text' },
    { key: 'awayScore', label: '客队比分', kind: 'int' },
    { key: 'homeScore', label: '主队比分', kind: 'int' },
    { key: 'inning',    label: '局数',     kind: 'int' },
    { key: 'half',      label: '半局',     kind: 'half' },
    { key: 'b1',        label: '一垒有人', kind: 'bool' },
    { key: 'b2',        label: '二垒有人', kind: 'bool' },
    { key: 'b3',        label: '三垒有人', kind: 'bool' },
    { key: 'outs',      label: '出局数',   kind: 'int' },
    { key: 'balls',     label: '坏球数 B', kind: 'int' },
    { key: 'strikes',   label: '好球数 S', kind: 'int' }
  ];

  /* ---------- SVG path 工具 ---------- */
  function n(v) { return Math.round(v * 100) / 100; }
  function rect(x, y, w, h) {
    return 'M' + n(x) + ',' + n(y) + ' H' + n(x + w) + ' V' + n(y + h) + ' H' + n(x) + ' Z';
  }
  function roundRect(x, y, w, h, r) {
    return 'M' + n(x + r) + ',' + n(y) + ' H' + n(x + w - r) + ' Q' + n(x + w) + ',' + n(y) + ' ' + n(x + w) + ',' + n(y + r) +
      ' V' + n(y + h - r) + ' Q' + n(x + w) + ',' + n(y + h) + ' ' + n(x + w - r) + ',' + n(y + h) +
      ' H' + n(x + r) + ' Q' + n(x) + ',' + n(y + h) + ' ' + n(x) + ',' + n(y + h - r) +
      ' V' + n(y + r) + ' Q' + n(x) + ',' + n(y) + ' ' + n(x + r) + ',' + n(y) + ' Z';
  }
  function bottomRoundRect(x, y, w, h, r) {
    return 'M' + n(x) + ',' + n(y) + ' H' + n(x + w) + ' V' + n(y + h - r) +
      ' Q' + n(x + w) + ',' + n(y + h) + ' ' + n(x + w - r) + ',' + n(y + h) +
      ' H' + n(x + r) + ' Q' + n(x) + ',' + n(y + h) + ' ' + n(x) + ',' + n(y + h - r) + ' Z';
  }
  function diamond(cx, cy, h) {
    return 'M' + n(cx) + ',' + n(cy - h) + ' L' + n(cx + h) + ',' + n(cy) +
      ' L' + n(cx) + ',' + n(cy + h) + ' L' + n(cx - h) + ',' + n(cy) + ' Z';
  }
  function circle(cx, cy, r) {
    return 'M' + n(cx - r) + ',' + n(cy) + ' a' + n(r) + ',' + n(r) + ' 0 1,0 ' + n(2 * r) + ',0 ' +
      'a' + n(r) + ',' + n(r) + ' 0 1,0 ' + n(-2 * r) + ',0 Z';
  }
  function dots(list, r) {
    return list.map(function (p) { return circle(p.cx, p.cy, r); }).join(' ');
  }
  function triUp(cx, top, half, h) {
    return 'M' + n(cx) + ',' + n(top) + ' L' + n(cx + half) + ',' + n(top + h) + ' L' + n(cx - half) + ',' + n(top + h) + ' Z';
  }
  function triDown(cx, bottom, half, h) {
    return 'M' + n(cx - half) + ',' + n(bottom - h) + ' L' + n(cx + half) + ',' + n(bottom - h) + ' L' + n(cx) + ',' + n(bottom) + ' Z';
  }
  function join() { return Array.prototype.slice.call(arguments).join(' '); }
  function hex(c) { return '#' + ('000000' + c.toString(16)).slice(-6); }
  function hexNum(c) { return '0x' + ('000000' + c.toString(16)).slice(-6).toUpperCase(); }
  function parseColor(v, fallback) {
    if (typeof v === 'number' && isFinite(v)) return Math.max(0, Math.min(0xFFFFFF, v | 0));
    var s = String(v == null ? '' : v).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16);
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
      return (parseInt(s[0] + s[0], 16) << 16) | (parseInt(s[1] + s[1], 16) << 8) | parseInt(s[2] + s[2], 16);
    }
    return fallback;
  }

  /* ---------- 计分条几何（单位：520 x 163） ---------- */
  var BASES = [
    { id: 'base2', cx: 292, cy: 45 },  // 二垒
    { id: 'base3', cx: 268, cy: 68 },  // 三垒
    { id: 'base1', cx: 316, cy: 68 }   // 一垒
  ];
  var OUTS = [ { cx: 263, cy: 122 }, { cx: 293, cy: 122 }, { cx: 323, cy: 122 } ];
  /* 右下角两行记数：B 行 3 颗（三坏球满）、S 行 2 颗（两好球满），两行左对齐 */
  var BALLS = [
    { cx: 398, cy: 101 }, { cx: 424, cy: 101 }, { cx: 450, cy: 101 }
  ];
  var STRIKES = [
    { cx: 398, cy: 137 }, { cx: 424, cy: 137 }
  ];
  var DOT_R = 8;

  /* ck 字段表示该形状/文字的颜色取自 options 的哪个可配置色 */
  var STATIC_SHAPES = [
    { id: 'pFrame',      d: roundRect(1, 1, 518, 159, 4),                 color: COLOR.frame,       z: 1 },
    { id: 'pBg',         d: roundRect(4, 4, 512, 152, 3),                 color: COLOR.bg,          z: 2 },
    { id: 'pAwayRow',    d: rect(5, 4, 167, 76),                           color: COLOR.bg,          ck: 'cAwayBg', z: 3 },
    { id: 'pHomeRow',    d: bottomRoundRect(5, 83, 167, 72, 4),           color: COLOR.blue,        ck: 'cHomeBg', z: 3 },
    { id: 'pRowB',       d: rect(350, 83, 165, 36),                        color: COLOR.bg,          ck: 'cCountBg', z: 3 },
    { id: 'pRowS',       d: bottomRoundRect(350, 119, 165, 36, 4),         color: COLOR.bg,          ck: 'cCountBg', z: 3 },
    { id: 'pLines',      d: join(rect(173, 4, 3, 152), rect(346, 4, 3, 152), rect(5, 80, 167, 2), rect(350, 80, 165, 2), rect(350, 118, 165, 1.5)), color: COLOR.line, z: 4 },
    { id: 'pMidLine',    d: rect(238, 8, 2, 144),                           color: COLOR.midLine,     z: 4 },
    { id: 'pBaseOff',    d: join(diamond(292, 45, 15), diamond(268, 68, 15), diamond(316, 68, 15)), color: COLOR.baseOff, z: 5, bw: 1, bc: 0x3E4150 },
    { id: 'pOutOff',     d: join(circle(263, 122, 7), circle(293, 122, 7), circle(323, 122, 7)),   color: COLOR.outOff, z: 5 },
    { id: 'pBallOff',    d: dots(BALLS, DOT_R),                              color: COLOR.ballOff,     z: 5 },
    { id: 'pStrikeOff',  d: dots(STRIKES, DOT_R),                            color: COLOR.strikeOff,   z: 5 },
    { id: 'pArrowOff',   d: join(triUp(205, 20, 10, 16), triDown(205, 134, 10, 16)), color: COLOR.arrowOff, z: 5 }
  ];

  var OVERLAY_SHAPES = [
    { id: 'pArrowUp',    d: triUp(205, 20, 10, 16),      color: COLOR.arrowOn,   z: 6, key: 'arrowUp' },
    { id: 'pArrowDown',  d: triDown(205, 134, 10, 16),   color: COLOR.arrowOn,   z: 6, key: 'arrowDown' },
    { id: 'pBase1On',    d: diamond(316, 68, 15),        color: COLOR.white,     ck: 'cBaseOn', z: 6, key: 'base1', bw: 1, bc: COLOR.baseEdge },
    { id: 'pBase2On',    d: diamond(292, 45, 15),        color: COLOR.white,     ck: 'cBaseOn', z: 6, key: 'base2', bw: 1, bc: COLOR.baseEdge },
    { id: 'pBase3On',    d: diamond(268, 68, 15),        color: COLOR.white,     ck: 'cBaseOn', z: 6, key: 'base3', bw: 1, bc: COLOR.baseEdge },
    { id: 'pOut1On',     d: circle(263, 122, 7),         color: COLOR.white,     z: 6, key: 'out1' },
    { id: 'pOut2On',     d: circle(293, 122, 7),         color: COLOR.white,     z: 6, key: 'out2' },
    { id: 'pOut3On',     d: circle(323, 122, 7),         color: COLOR.white,     z: 6, key: 'out3' },
    { id: 'pBall1On',    d: circle(BALLS[0].cx, BALLS[0].cy, DOT_R), color: COLOR.countOn, z: 7, key: 'ball1' },
    { id: 'pBall2On',    d: circle(BALLS[1].cx, BALLS[1].cy, DOT_R), color: COLOR.countOn, z: 7, key: 'ball2' },
    { id: 'pBall3On',    d: circle(BALLS[2].cx, BALLS[2].cy, DOT_R), color: COLOR.countOn, z: 7, key: 'ball3' },
    { id: 'pStrike1On',  d: circle(STRIKES[0].cx, STRIKES[0].cy, DOT_R), color: COLOR.countOn, z: 7, key: 'strike1' },
    { id: 'pStrike2On',  d: circle(STRIKES[1].cx, STRIKES[1].cy, DOT_R), color: COLOR.countOn, z: 7, key: 'strike2' }
  ];

  var TEXT_DEFS = [
    { id: 'tAwayName',   x: 10,  y: 41,  ax: 0,   size: 48, color: COLOR.white,     ck: 'cAwayFg', get: function (s) { return s.awayName; } },
    { id: 'tAwayScore',  x: 158, y: 41,  ax: 1,   size: 52, color: COLOR.white,     ck: 'cAwayFg', get: function (s) { return String(s.awayScore); } },
    { id: 'tHomeName',   x: 10,  y: 122, ax: 0,   size: 48, color: COLOR.white,     ck: 'cHomeFg', get: function (s) { return s.homeName; } },
    { id: 'tHomeScore',  x: 158, y: 122, ax: 1,   size: 52, color: COLOR.white,     ck: 'cHomeFg', get: function (s) { return String(s.homeScore); } },
    { id: 'tInning',     x: 205, y: 82,  ax: 0.5, size: 54, color: COLOR.white,     get: function (s) { return String(s.inning); } },
    { id: 'tCount',      x: 432, y: 41,  ax: 0.5, size: 50, color: COLOR.white,     get: function (s) { return s.balls + '-' + s.strikes; } },
    { id: 'tBallLabel',  x: 358, y: 101, ax: 0,   size: 27, color: COLOR.blueWhite, get: function () { return 'B'; } },
    { id: 'tStrikeLabel',x: 358, y: 137, ax: 0,   size: 27, color: COLOR.white,     get: function () { return 'S'; } },
    { id: 'tBallNum',    x: 502, y: 101, ax: 1,   size: 30, color: COLOR.white,     get: function (s) { return String(s.balls); } },
    { id: 'tStrikeNum',  x: 502, y: 137, ax: 1,   size: 30, color: COLOR.white,     get: function (s) { return String(s.strikes); } }
  ];

  /* ---------- 状态 → 各对象可变量的取值 ---------- */
  function overlayAlphas(s) {
    return {
      arrowUp:   s.half === 'top' ? 1 : 0,
      arrowDown: s.half === 'bottom' ? 1 : 0,
      base1:     s.b1 ? 1 : 0,
      base2:     s.b2 ? 1 : 0,
      base3:     s.b3 ? 1 : 0,
      out1:      s.outs >= 1 ? 1 : 0,
      out2:      s.outs >= 2 ? 1 : 0,
      out3:      s.outs >= 3 ? 1 : 0,
      ball1:     s.balls >= 1 ? 1 : 0,
      ball2:     s.balls >= 2 ? 1 : 0,
      ball3:     s.balls >= 3 ? 1 : 0,
      strike1:   s.strikes >= 1 ? 1 : 0,
      strike2:   s.strikes >= 2 ? 1 : 0
    };
  }

  function dynamicValues(s) {
    var v = {
      tAwayName:   { attr: 'content', raw: s.awayName,               fmt: basString(s.awayName) },
      tHomeName:   { attr: 'content', raw: s.homeName,               fmt: basString(s.homeName) },
      tAwayScore:  { attr: 'content', raw: String(s.awayScore),      fmt: basString(String(s.awayScore)) },
      tHomeScore:  { attr: 'content', raw: String(s.homeScore),      fmt: basString(String(s.homeScore)) },
      tInning:     { attr: 'content', raw: String(s.inning),         fmt: basString(String(s.inning)) },
      tCount:      { attr: 'content', raw: s.balls + '-' + s.strikes, fmt: basString(s.balls + '-' + s.strikes) },
      tBallNum:    { attr: 'content', raw: String(s.balls),          fmt: basString(String(s.balls)) },
      tStrikeNum:  { attr: 'content', raw: String(s.strikes),        fmt: basString(String(s.strikes)) }
    };
    var a = overlayAlphas(s);
    Object.keys(a).forEach(function (k) {
      var on = /^(base|out|ball|strike)/.test(k);
      var id = 'p' + k.charAt(0).toUpperCase() + k.slice(1) + (on ? 'On' : '');
      v[id] = { attr: 'alpha', raw: String(a[k]), fmt: String(a[k]) };
    });
    return v;
  }

  function basString(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ') + '"';
  }

  /* ---------- 坐标换算与四角定位 ---------- */
  function heightPct(widthPct) {
    return widthPct * (BOARD_H / BOARD_W) * (STAGE_W / STAGE_H);
  }
  function effectivePosition(o) {
    var w = Number(o.widthPct) || DEFAULT_OPTIONS.widthPct;
    var h = heightPct(w);
    var m = Number(o.marginPct === undefined ? DEFAULT_OPTIONS.marginPct : o.marginPct) || 0;
    var x = Number(o.xPct === undefined ? DEFAULT_OPTIONS.xPct : o.xPct);
    var y = Number(o.yPct === undefined ? DEFAULT_OPTIONS.yPct : o.yPct);
    switch (o.anchor) {
      case 'tl': x = m;                y = m;                break;
      case 'tr': x = 100 - w - m;      y = m;                break;
      case 'bl': x = m;                y = 100 - h - m;      break;
      case 'br': x = 100 - w - m;      y = 100 - h - m;      break;
      default: break; // custom：直接用 xPct / yPct
    }
    return { x: x, y: y, h: h, w: w };
  }
  function toPercent(v) { return (Math.round(v * 1000) / 1000) + '%'; }
  function bx(u, o) { return toPercent(o.effX + u * o.widthPct / BOARD_W); }
  function by(u, o) { return toPercent(o.effY + u * o.heightPct / BOARD_H); }
  function fs(u, o) { return toPercent(u * o.widthPct / BOARD_W); }

  /* ---------- 字号：可调缩放 + 队名/比分两位数自动避让 ---------- */
  var TEXT_BY_ID = {};
  TEXT_DEFS.forEach(function (t) { TEXT_BY_ID[t.id] = t; });
  var ROW_LEFT = 10, ROW_RIGHT = 158, MIN_GAP = 20;  // 队名左锚点 / 比分右锚点 / 目标最小间隙
  /* 20 是安全上限：队名 3 字 + 比分 1 位的估算宽 = 125.2 < 148-20 = 128，
     所以一位数比分仍保持原始字号，默认脚本逐字节不变；两位数才触发缩小。 */
  var NAME_W = 0.66, DIGIT_W = 0.58;                 // Arial Bold 粗估单字宽 / 字号

  function isName(t) { return t.id === 'tAwayName' || t.id === 'tHomeName'; }
  function isScore(t) { return t.id === 'tAwayScore' || t.id === 'tHomeScore'; }
  function clampScale(v, dflt) {
    var x = Number(v);
    if (!isFinite(x) || x <= 0) x = dflt;
    return Math.max(60, Math.min(140, x));
  }
  function baseTextSize(t, s, o) {
    var size = t.size * o.fontScale / 100;
    if (isName(t) || isScore(t)) size *= o.nameScoreScale / 100;
    if (isName(t)) {
      var name = String(t.id === 'tAwayName' ? s.awayName : s.homeName);
      if (name.length > 3) size = Math.max(20, size * 3 / name.length);
    }
    return size;
  }
  /* 一行里「队名 + 比分」的估算宽度超出可用宽度时，两者一起等比缩小 */
  function rowFit(s, o, away) {
    if (!o.autoFit) return 1;
    var nT = TEXT_BY_ID[away ? 'tAwayName' : 'tHomeName'];
    var cT = TEXT_BY_ID[away ? 'tAwayScore' : 'tHomeScore'];
    var name = String(away ? s.awayName : s.homeName);
    var score = String(away ? s.awayScore : s.homeScore);
    var w = name.length * NAME_W * baseTextSize(nT, s, o) +
            score.length * DIGIT_W * baseTextSize(cT, s, o);
    var avail = ROW_RIGHT - ROW_LEFT - MIN_GAP;
    return w > avail ? Math.max(0.55, avail / w) : 1;
  }
  function textSize(t, s, o) {
    var size = baseTextSize(t, s, o);
    if (isName(t) || isScore(t)) size *= rowFit(s, o, /Away/.test(t.id));
    return Math.round(size * 10) / 10;
  }
  /* BAS 的 fontSize 写在 def 里、时间轴只能改 content，所以按所有快照中
     「队名最长 / 比分位数最多」的状态固化字号，保证后续变成两位数时也不会挤。 */
  function worstFitState(initial, events) {
    var s = Object.assign({}, initial);
    buildSnapshots(initial, events).forEach(function (snap) {
      var st = snap.state;
      if (String(st.awayName).length > String(s.awayName).length) s.awayName = st.awayName;
      if (String(st.homeName).length > String(s.homeName).length) s.homeName = st.homeName;
      if (String(st.awayScore).length > String(s.awayScore).length) s.awayScore = st.awayScore;
      if (String(st.homeScore).length > String(s.homeScore).length) s.homeScore = st.homeScore;
    });
    return s;
  }
  function fontSizes(state, options) {
    var s = Object.assign({}, DEFAULT_STATE, state || {});
    var o = normalizeOptions(options);
    return {
      awayName: textSize(TEXT_BY_ID.tAwayName, s, o),
      awayScore: textSize(TEXT_BY_ID.tAwayScore, s, o),
      homeName: textSize(TEXT_BY_ID.tHomeName, s, o),
      homeScore: textSize(TEXT_BY_ID.tHomeScore, s, o)
    };
  }

  /* ---------- BAS 脚本生成 ---------- */
  function shapeColor(sh, o) { return sh.ck ? o[sh.ck] : sh.color; }
  function textColor(t, o) { return t.ck ? o[t.ck] : t.color; }

  function pathDef(shape, o, alpha) {
    var L = [];
    L.push('def path ' + shape.id + ' {');
    L.push('    d = "' + shape.d + '"');
    L.push('    viewBox = "0 0 520 163"');
    L.push('    width = ' + toPercent(o.widthPct));
    L.push('    height = ' + toPercent(o.heightPct));
    L.push('    x = ' + toPercent(o.effX));
    L.push('    y = ' + toPercent(o.effY));
    L.push('    fillColor = ' + hexNum(shapeColor(shape, o)));
    if (shape.bw) {
      L.push('    borderWidth = ' + shape.bw);
      L.push('    borderColor = ' + hexNum(shape.bc));
    }
    if (alpha !== undefined) L.push('    alpha = ' + alpha);
    L.push('    zIndex = ' + shape.z);
    L.push('    duration = ' + o.duration);
    L.push('}');
    return L.join('\n');
  }

  function textDef(t, state, o, fitState) {
    var L = [];
    L.push('def text ' + t.id + ' {');
    L.push('    content = ' + basString(t.get(state)));
    L.push('    x = ' + bx(t.x, o));
    L.push('    y = ' + by(t.y, o));
    L.push('    anchorX = ' + t.ax);
    L.push('    anchorY = 0.5');
    /* content 取当前状态，fontSize 取时间轴最宽状态（生成时固化） */
    L.push('    fontSize = ' + fs(textSize(t, fitState || state, o), o));
    L.push('    fontFamily = "Arial"');
    L.push('    color = ' + hexNum(textColor(t, o)));
    L.push('    bold = 1');
    L.push('    textShadow = 0');
    L.push('    zIndex = 9');
    L.push('    duration = ' + o.duration);
    L.push('}');
    return L.join('\n');
  }

  function normalizeOptions(o) {
    o = o || {};
    var r = {
      widthPct: Number(o.widthPct || DEFAULT_OPTIONS.widthPct),
      xPct: Number(o.xPct === undefined ? DEFAULT_OPTIONS.xPct : o.xPct),
      yPct: Number(o.yPct === undefined ? DEFAULT_OPTIONS.yPct : o.yPct),
      anchor: o.anchor || DEFAULT_OPTIONS.anchor,
      marginPct: Number(o.marginPct === undefined ? DEFAULT_OPTIONS.marginPct : o.marginPct),
      duration: o.duration || DEFAULT_OPTIONS.duration,
      cAwayBg: parseColor(o.awayBg, 0x0B0B0C),
      cAwayFg: parseColor(o.awayFg, 0xFFFFFF),
      cHomeBg: parseColor(o.homeBg, 0x2C51C2),
      cHomeFg: parseColor(o.homeFg, 0xFFFFFF),
      cCountBg: parseColor(o.countBg, 0x0B0B0C),
      cBaseOn: parseColor(o.baseOn, 0xFFFFFF),
      fontScale: clampScale(o.fontScale, 100),
      nameScoreScale: clampScale(o.nameScoreScale, 100),
      autoFit: o.autoFit === undefined ? true :
        (o.autoFit === true || o.autoFit === 1 || o.autoFit === '1' || o.autoFit === 'true')
    };
    var p = effectivePosition(r);
    r.effX = p.x; r.effY = p.y; r.heightPct = p.h;
    return r;
  }

  function applyPatch(state, field, value) {
    var s = Object.assign({}, state);
    var v = String(value).trim();
    switch (field) {
      case 'awayName': case 'homeName': s[field] = v.slice(0, 8); break;
      case 'awayScore': case 'homeScore': case 'inning': case 'outs': case 'balls': case 'strikes':
        s[field] = Math.max(0, parseInt(v, 10) || 0); break;
      case 'half':
        s.half = (v === '上' || v === 'top' || v === '1') ? 'top' : 'bottom'; break;
      case 'b1': case 'b2': case 'b3':
        s[field] = (v === '0' || v === '无' || v === 'false' || v === '') ? 0 : 1; break;
    }
    return s;
  }

  function buildSnapshots(initial, events) {
    var list = (events || []).slice().filter(function (e) { return e && e.field && e.t !== ''; })
      .map(function (e) { return { t: Math.max(0, Number(e.t) || 0), field: e.field, value: e.value }; })
      .sort(function (a, b) { return a.t - b.t; });
    var snaps = [{ t: 0, state: Object.assign({}, initial) }];
    list.forEach(function (e) {
      snaps.push({ t: e.t, state: applyPatch(snaps[snaps.length - 1].state, e.field, e.value) });
    });
    return snaps;
  }

  function generateChains(initial, events) {
    var snaps = buildSnapshots(initial, events);
    if (snaps.length < 2) return '';
    var targets = Object.keys(dynamicValues(initial));
    var chains = [];
    targets.forEach(function (target) {
      var prev = dynamicValues(snaps[0].state)[target];
      var steps = [];
      var cursor = 0;
      snaps.slice(1).forEach(function (snap) {
        var cur = dynamicValues(snap.state)[target];
        if (cur.raw !== prev.raw) {
          steps.push({ wait: Math.max(0.01, snap.t - cursor), attr: cur.attr, val: cur.fmt });
          cursor = snap.t;
          prev = cur;
        }
      });
      if (!steps.length) return;
      var L = [];
      steps.forEach(function (st, i) {
        var head = i === 0 ? 'set ' : 'then set ';
        L.push(head + target + ' {} ' + (Math.round(st.wait * 1000) / 1000) + 's');
        L.push('then set ' + target + ' { ' + st.attr + ' = ' + st.val + ' } 0.01s');
      });
      chains.push(L.join('\n'));
    });
    return chains.length ? '\n' + chains.join('\n\n') + '\n' : '';
  }

  function generateBAS(state, options, events) {
    var s = Object.assign({}, DEFAULT_STATE, state || {});
    var o = normalizeOptions(options);
    var alphas = overlayAlphas(s);
    var fitState = worstFitState(s, events || []);
    var blocks = [];

    STATIC_SHAPES.forEach(function (sh) { blocks.push(pathDef(sh, o)); });
    OVERLAY_SHAPES.forEach(function (sh) { blocks.push(pathDef(sh, o, alphas[sh.key])); });
    TEXT_DEFS.forEach(function (t) { blocks.push(textDef(t, s, o, fitState)); });

    return blocks.join('\n\n') + '\n' + generateChains(s, events || []);
  }

  /* ---------- SVG 预览生成（与 BAS 使用同一套几何 / 同一套配色） ---------- */
  /* preview.fieldBg === false 时输出透明背景，便于叠加到视频画面上 */
  function renderSVG(state, options, preview) {
    var s = Object.assign({}, DEFAULT_STATE, state || {});
    var o = normalizeOptions(options);
    var fieldBg = !preview || preview.fieldBg !== false;
    var fitState = (preview && preview.fitState) || s;
    var scale = o.widthPct / 52;
    var tx = o.effX * 10, ty = o.effY * 5.625;
    var alphas = overlayAlphas(s);
    var out = [];

    if (fieldBg) {
      out.push('<defs>');
      out.push('<linearGradient id="fieldBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17233a"/><stop offset="0.55" stop-color="#1d3b2a"/><stop offset="1" stop-color="#2c5b34"/></linearGradient>');
      out.push('<radialGradient id="vignette" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></radialGradient>');
      out.push('</defs>');
      out.push('<rect x="0" y="0" width="1000" height="562.5" fill="url(#fieldBg)"/>');
      out.push('<path d="M500,250 L650,340 L500,430 L350,340 Z" fill="#000" opacity="0.08"/>');
      out.push('<rect x="0" y="0" width="1000" height="562.5" fill="url(#vignette)"/>');
    }
    out.push('<g transform="translate(' + n(tx) + ',' + n(ty) + ') scale(' + n(scale) + ')">');

    STATIC_SHAPES.forEach(function (sh) { out.push(svgPath(sh, 1, o)); });
    OVERLAY_SHAPES.forEach(function (sh) { out.push(svgPath(sh, alphas[sh.key], o)); });
    TEXT_DEFS.forEach(function (t) {
      var anchor = t.ax === 0 ? 'start' : (t.ax === 1 ? 'end' : 'middle');
      out.push('<text x="' + t.x + '" y="' + t.y + '" font-size="' + textSize(t, fitState, o) + '" font-family="Arial, Helvetica, sans-serif" font-weight="bold" fill="' + hex(textColor(t, o)) + '" text-anchor="' + anchor + '" dominant-baseline="central">' + escapeXML(t.get(s)) + '</text>');
    });
    out.push('</g>');
    return out.join('\n');
  }

  function svgPath(sh, alpha, o) {
    if (!alpha) return '';
    var s = '<path d="' + sh.d + '" fill="' + hex(shapeColor(sh, o)) + '"';
    if (sh.bw) s += ' stroke="' + hex(sh.bc) + '" stroke-width="' + sh.bw + '"';
    return s + '/>';
  }
  function escapeXML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stateAtTime(initial, events, t) {
    var snaps = buildSnapshots(initial, events);
    var state = snaps[0].state;
    for (var i = 1; i < snaps.length; i++) if (snaps[i].t <= t) state = snaps[i].state;
    return state;
  }

  return {
    BOARD_W: BOARD_W, BOARD_H: BOARD_H, STAGE_W: STAGE_W, STAGE_H: STAGE_H,
    DEFAULT_STATE: DEFAULT_STATE, DEFAULT_OPTIONS: DEFAULT_OPTIONS, EVENT_FIELDS: EVENT_FIELDS,
    COLOR: COLOR,
    generateBAS: generateBAS,
    renderSVG: renderSVG,
    applyPatch: applyPatch,
    buildSnapshots: buildSnapshots,
    stateAtTime: stateAtTime,
    overlayAlphas: overlayAlphas,
    effectivePosition: effectivePosition,
    heightPct: heightPct,
    fontSizes: fontSizes,
    worstFitState: worstFitState,
    hex: hex
  };
});
