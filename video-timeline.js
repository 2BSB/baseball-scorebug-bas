/* 在线视频 · 时间轴对照适配层 · scorebug-timeline/1.0
 * 职责：解析 B 站链接 → 生成可嵌入的播放器地址 → 规范化手工编辑的时间轴 → 按投放时间对齐。
 * 浏览器与 Node 共用（UMD）。生成器本体 scorebug-generator.js 不依赖本文件。
 *
 * 本版本已彻底移除本地模型 / HTTP 识别接口：局数、比分、球数全部由使用者
 * 对照内嵌播放器画面手工打点编辑。内置的示例时间轴仅用于演示对照流程，
 * 是按片长与弹幕线索编排的占位数据，不代表真实比赛统计。
 *
 * 跨域说明：B 站 iframe 播放器不向父页面公开播放进度，因此在线模式采用
 * 「看播放器进度条 → 手动填入当前秒 → 点击刻度/事件跳转」；
 * 需要逐帧精确同步时，可载入本地视频文件，由 <video>.currentTime 自动读写。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ScorebugVideoTimeline = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var SCHEMA = 'scorebug-timeline/1.0';
  var FIELDS = ['awayName','homeName','awayScore','homeScore','inning','half',
                'b1','b2','b3','outs','balls','strikes'];

  /* ---------- 示例视频的公开元数据（B 站 API 实测，2026-11-08） ---------- */
  var SAMPLE_VIDEO = {
    bvid: 'BV19f4H6xE9B',
    aid: '117576575225102',
    title: '1107红钻棒球队 队内比赛',
    url: 'https://www.bilibili.com/video/BV19f4H6xE9B/',
    uploader: '射射花',
    page: 1,
    part: '比赛',
    cid: '43418848432',
    duration: 1685,          // P1「比赛」时长（秒）
    totalDuration: 1871,     // 全片（含 P2「Perry」186 秒）
    pages: [
      { page: 1, part: '比赛',  duration: 1685, cid: '43418848432' },
      { page: 2, part: 'Perry', duration: 186,  cid: '43423370389' }
    ],
    subtitle: false,
    danmakuCues: [
      { t: 564.075,  text: '马查多行为：打出去就站那里看' },
      { t: 814.625,  text: '这球太强了' },
      { t: 1353.866, text: 'MVP 庆祝动作' },
      { t: 1457.230, text: '投手已崩溃' },
      { t: 1505.506, text: '这个似乎是好球' },
      { t: 1506.266, text: '这是好球hhhh投手哭了' },
      { t: 1521.836, text: 'SS 守得太深了' }
    ],
    note: '本垒后方固定机位，全程无记分板/比分叠字，B 站无字幕、仅 7 条弹幕。' +
          '局数与比分需对照画面手工打点；下方内置时间轴仅用于演示编辑流程。'
  };

  /* ---------- B 站链接解析（纯前端，不发起跨域请求） ---------- */
  function parseBiliUrl(input) {
    var s = String(input == null ? '' : input).trim();
    var r = { raw: s, bvid: '', avid: '', page: 1, startTime: 0, valid: false, shortLink: false, error: '' };
    if (!s) { r.error = '请先粘贴 B 站视频链接'; return r; }
    if (/b23\.tv|bilibili\.com\/s\//i.test(s)) r.shortLink = true;
    var m = /BV[0-9A-Za-z]{10}/.exec(s); if (m) r.bvid = m[0];
    var a = /(?:^|\/|av|aid=)(\d{6,})/i.exec(s); if (a) r.avid = a[1];
    var p = /[?&]p=(\d+)/i.exec(s); if (p) r.page = Math.max(1, parseInt(p[1], 10) || 1);
    var t = /[?&](?:t|start)=([0-9]+(?:\.[0-9]+)?)/i.exec(s);
    if (t) r.startTime = Number(t[1]) || 0;
    r.valid = !!(r.bvid || r.avid);
    if (!r.valid) r.error = r.shortLink
      ? '短链需要先在浏览器打开后复制完整 bilibili.com/video/BV... 地址'
      : '未识别到 BV 号或 av 号';
    return r;
  }

  /* ---------- 播放器地址 ---------- */
  function samplePage(info, sample) {
    var v = sample || SAMPLE_VIDEO;
    if (!info || !info.bvid || info.bvid !== v.bvid) return null;
    return v.pages[info.page - 1] || null;
  }
  /* B 站官方外链播放器参数（https://player.bilibili.com/）：
   * aid/bvid 选一、p=分P集数、cid=分P视频、t=起始秒、autoplay/danmaku 为布尔。
   * 官方说明「若有 cid 参数，则 p 参数不生效」，所以已知分 P 的 cid 时只给 cid。
   */
  function buildPlayerSrc(info, t, sample) {
    if (!info || !info.valid) return '';
    var q = [];
    if (info.bvid) q.push('bvid=' + encodeURIComponent(info.bvid));
    else q.push('aid=' + encodeURIComponent(info.avid));
    var pg = samplePage(info, sample);
    if (pg && pg.cid) q.push('cid=' + encodeURIComponent(pg.cid));
    else q.push('p=' + (info.page || 1));
    var sec = Math.max(0, Math.floor(Number(t) || 0));
    if (sec > 0) q.push('t=' + sec);
    q.push('as_wide=1', 'high_quality=1', 'danmaku=0', 'autoplay=0');
    return 'https://player.bilibili.com/player.html?' + q.join('&');
  }
  /* 在原站打开（播放器被拦截时的降级方式） */
  function buildWatchUrl(info, t) {
    if (!info || !info.valid) return '';
    var sec = Math.max(0, Math.floor(Number(t) || 0));
    var base = 'https://www.bilibili.com/video/' + (info.bvid || ('av' + info.avid)) + '/';
    return base + '?p=' + (info.page || 1) + (sec > 0 ? '&t=' + sec : '');
  }

  /* ---------- 时间码 ---------- */
  function formatTime(t) {
    t = Math.max(0, Math.round(Number(t) || 0));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var mm = ('0' + m).slice(-2), ss = ('0' + s).slice(-2);
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }
  /* 支持 "83" / "01:23" / "1:02:03"；非法返回 null */
  function parseTimeCode(str) {
    var s = String(str == null ? '' : str).trim();
    if (!s) return null;
    if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
    var parts = s.split(':');
    if (parts.length < 2 || parts.length > 3) return null;
    var v = 0;
    for (var i = 0; i < parts.length; i++) {
      if (!/^\d+(?:\.\d+)?$/.test(parts[i])) return null;
      v = v * 60 + Number(parts[i]);
    }
    return v;
  }

  /* ---------- 状态补丁（与 scorebug-generator.applyPatch 保持一致） ---------- */
  function defaultApplyPatch(state, field, value) {
    var s = Object.assign({}, state);
    var v = String(value == null ? '' : value).trim();
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

  /* ---------- 时间轴规范化（手工编辑 / 导入的 JSON 都走这里） ---------- */
  function normalizeTimeline(raw) {
    var r = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    var initial = Object.assign({
      awayName:'RDA', homeName:'RDB', awayScore:0, homeScore:0,
      inning:1, half:'top', b1:0, b2:0, b3:0, outs:0, balls:0, strikes:0
    }, r.initial || {});
    var unknown = [];
    var events = (r.events || []).map(function (e) {
      return {
        t: Math.max(0, Number(e.t) || 0),
        field: String(e.field || '').trim(),
        value: String(e.value == null ? '' : e.value),
        note: String(e.note || '')
      };
    }).filter(function (e) {
      if (!e.field) return false;
      if (FIELDS.indexOf(e.field) < 0) { unknown.push(e.field); return false; }
      return true;
    }).sort(function (a, b) { return a.t - b.t; });
    return {
      schema: r.schema || SCHEMA,
      video: r.video || {},
      source: r.source || 'manual',
      initial: initial,
      events: events,
      unknownFields: unknown
    };
  }

  /* ---------- 按投放时间对齐 ----------
   * events[].t 是「视频绝对秒」；offset 是高级弹幕投放在视频中的时刻。
   * t <= offset 的变化并入初始状态，其余换算成弹幕相对秒。
   */
  function alignTimeline(initial, events, offset, applyPatch) {
    var apply = applyPatch || defaultApplyPatch;
    var off = Math.max(0, Number(offset) || 0);
    var state = Object.assign({}, initial);
    var rel = [], absorbed = 0;
    (events || []).slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (e) {
      if (Number(e.t) <= off) {
        state = apply(state, e.field, e.value);
        absorbed++;
      } else {
        rel.push({
          t: Math.round((Number(e.t) - off) * 1000) / 1000,
          field: e.field,
          value: e.value
        });
      }
    });
    return { initial: state, events: rel, absorbed: absorbed, offset: off };
  }

  /* 导出手工时间轴（不含模型/识别语义） */
  function exportTimeline(state, events, meta) {
    return {
      schema: SCHEMA,
      video: meta || {},
      source: 'manual',
      initial: Object.assign({}, state),
      events: (events || []).map(function (e) { return { t: e.t, field: e.field, value: e.value }; })
    };
  }

  /* ---------- 内置示例时间轴（可复现、无随机，仅供对照编辑演示） ---------- */
  function buildSampleTimeline() {
    var bounds = [0, 168, 337, 505, 674, 842, 1011, 1179, 1348, 1516, 1685];
    var ev = [];
    function push(t, field, value, note) {
      ev.push({ t: Math.round(t * 1000) / 1000, field: field, value: String(value), note: note || '' });
    }
    /* 每个半局：一次打席的球数推进 → 上垒 → 出局 → 换局前清场 */
    for (var i = 0; i < 10; i++) {
      var start = bounds[i], n = Math.floor(i / 2) + 1, half = (i % 2 === 0) ? 'top' : 'bottom';
      if (i > 0) {
        push(start + 1, 'inning', n, '第 ' + n + ' 局' + (half === 'top' ? '上' : '下') + '开始');
        push(start + 1, 'half', half, '攻守交换');
      }
      push(start + 18, 'balls', 1, '打席开始');
      push(start + 38, 'strikes', 1, '');
      push(start + 58, 'strikes', 2, '');
      push(start + 75, 'b1', 1, '安打上垒');
      push(start + 78, 'balls', 0, '打席结束重置');
      push(start + 78, 'strikes', 0, '打席结束重置');
      push(start + 105, 'outs', 1, '一出局');
      push(start + 122, 'b2', 1, '推进到二垒');
      push(start + 150, 'outs', 0, '半局结束清场');
      push(start + 150, 'balls', 0, '半局结束清场');
      push(start + 150, 'strikes', 0, '半局结束清场');
      push(start + 150, 'b1', 0, '半局结束清场');
      push(start + 150, 'b2', 0, '半局结束清场');
      push(start + 150, 'b3', 0, '半局结束清场');
    }
    /* 得分节点：值为「更新后的累计比分」 */
    var scores = [
      { t: 145,      field: 'awayScore', value: 1, note: '1 上 首分' },
      { t: 310,      field: 'homeScore', value: 2, note: '1 下 两分打点' },
      { t: 564.075,  field: 'awayScore', value: 2, note: '弹幕 564s「马查多行为：打出去就站那里看」' },
      { t: 814.625,  field: 'awayScore', value: 4, note: '弹幕 814s「这球太强了」→ 两分' },
      { t: 980,      field: 'homeScore', value: 3, note: '3 下 追分' },
      { t: 1300,     field: 'homeScore', value: 4, note: '4 下 追平' },
      { t: 1457.230, field: 'awayScore', value: 5, note: '弹幕 1457s「投手已崩溃」' },
      { t: 1620,     field: 'homeScore', value: 6, note: '5 下 再见安打，比赛结束' }
    ];
    scores.forEach(function (s) { push(s.t, s.field, s.value, s.note); });
    [
      { t: 1353.866, field: 'b3',      value: 1, note: '弹幕 1353s「MVP 庆祝动作」→ 三垒有人' },
      { t: 1505.506, field: 'strikes', value: 2, note: '弹幕 1505s「这个似乎是好球」' },
      { t: 1506.266, field: 'balls',   value: 1, note: '弹幕 1506s「这是好球hhhh投手哭了」' },
      { t: 1521.836, field: 'b1',      value: 1, note: '弹幕 1521s「SS 守得太深了」→ 上垒' }
    ].forEach(function (s) { push(s.t, s.field, s.value, s.note); });

    ev.sort(function (a, b) { return a.t - b.t; });
    return {
      schema: SCHEMA,
      video: Object.assign({}, SAMPLE_VIDEO),
      source: 'built-in-sample',
      initial: {
        awayName: 'RDA', homeName: 'RDB', awayScore: 0, homeScore: 0,
        inning: 1, half: 'top', b1: 0, b2: 0, b3: 0, outs: 0, balls: 0, strikes: 0
      },
      events: ev
    };
  }

  return {
    SCHEMA: SCHEMA,
    FIELDS: FIELDS,
    SAMPLE_VIDEO: SAMPLE_VIDEO,
    parseBiliUrl: parseBiliUrl,
    buildPlayerSrc: buildPlayerSrc,
    buildWatchUrl: buildWatchUrl,
    samplePage: samplePage,
    formatTime: formatTime,
    parseTimeCode: parseTimeCode,
    normalizeTimeline: normalizeTimeline,
    alignTimeline: alignTimeline,
    exportTimeline: exportTimeline,
    buildSampleTimeline: buildSampleTimeline,
    defaultApplyPatch: defaultApplyPatch
  };
});
