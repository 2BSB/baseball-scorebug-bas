/* 产出「完整可验证」的 BAS 脚本 + 手工时间轴 JSON + 时间轴对照表（本地构建用）。
 *
 * 隐私说明：下面这段示例视频元数据与演示时间轴只存在于本构建脚本中，
 * 不会被 bundle.js / 网页引用，因此公网页面上没有任何预置视频、比赛或弹幕信息。
 * 页面打开时为空表单，访问者输入的数据只在其浏览器内存中处理。
 */
const fs = require('fs');
const path = require('path');
const V = require('./video-timeline.js');
const G = require('./scorebug-generator.js');

/* ---------- 本地示例数据（不打包进网页） ---------- */
const SAMPLE_VIDEO = {
  bvid: 'BV19f4H6xE9B',
  aid: '117576575225102',
  title: '1107红钻棒球队 队内比赛',
  url: 'https://www.bilibili.com/video/BV19f4H6xE9B/',
  uploader: '射射花',
  page: 1,
  part: '比赛',
  cid: '43418848432',
  duration: 1685,
  totalDuration: 1871,
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

function buildSampleTimeline() {
  var bounds = [0, 168, 337, 505, 674, 842, 1011, 1179, 1348, 1516, 1685];
  var ev = [];
  function push(t, field, value, note) {
    ev.push({ t: Math.round(t * 1000) / 1000, field: field, value: String(value), note: note || '' });
  }
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
    schema: 'scorebug-timeline/1.0',
    video: Object.assign({}, SAMPLE_VIDEO),
    source: 'built-in-sample',
    initial: {
      awayName: 'RDA', homeName: 'RDB', awayScore: 0, homeScore: 0,
      inning: 1, half: 'top', b1: 0, b2: 0, b3: 0, outs: 0, balls: 0, strikes: 0
    },
    events: ev
  };
}

/* ---------- 生成交付文件 ---------- */
const root = __dirname;
const raw = buildSampleTimeline();
const timeline = V.normalizeTimeline(raw);
const offset = 0;                       // 弹幕投放在视频 00:00
const aligned = V.alignTimeline(timeline.initial, timeline.events, offset, G.applyPatch);
const options = Object.assign({}, G.DEFAULT_OPTIONS, { duration: '30m' });

const code = G.generateBAS(aligned.initial, options, aligned.events);
fs.writeFileSync(path.join(root, 'BV19f4H6xE9B-完整计分.bas'), code, 'utf8');
fs.writeFileSync(path.join(root, '视频时间轴示例.json'), JSON.stringify(raw, null, 2), 'utf8');

const csv = ['\uFEFF视频秒,时间码,字段,新值,说明/来源'];
timeline.events.forEach(function (e) {
  csv.push([e.t, V.formatTime(e.t), e.field, e.value, String(e.note || '').replace(/,/g, '，')].join(','));
});
fs.writeFileSync(path.join(root, 'BV19f4H6xE9B-时间轴对照.csv'), csv.join('\r\n'), 'utf8');

console.log('video:', raw.video.title, '| P' + raw.video.page, raw.video.part, raw.video.duration + 's');
console.log('events:', timeline.events.length, '| aligned:', aligned.events.length, '| absorbed:', aligned.absorbed);
console.log('duration:', options.duration, '| defs:', (code.match(/^def /gm) || []).length,
            '| chains:', (code.match(/^set /gm) || []).length, '| chars:', code.length);
console.log('files: BV19f4H6xE9B-完整计分.bas / 视频时间轴示例.json / BV19f4H6xE9B-时间轴对照.csv');
