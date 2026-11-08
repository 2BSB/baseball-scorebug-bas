/* 以 BV19f4H6xE9B 为例，产出「完整可验证」的 BAS 脚本 + 手工时间轴 JSON + 时间轴对照表 */
const fs = require('fs');
const path = require('path');
const V = require('./video-timeline.js');
const G = require('./scorebug-generator.js');

const root = __dirname;
const raw = V.buildSampleTimeline();
const timeline = V.normalizeTimeline(raw);
const offset = 0;                       // 弹幕投放在视频 00:00
const aligned = V.alignTimeline(timeline.initial, timeline.events, offset, G.applyPatch);
const options = Object.assign({}, G.DEFAULT_OPTIONS, { duration: '30m' }); // 1800s > P1 1685s

const code = G.generateBAS(aligned.initial, options, aligned.events);
fs.writeFileSync(path.join(root, 'BV19f4H6xE9B-完整计分.bas'), code, 'utf8');
fs.writeFileSync(path.join(root, '视频时间轴示例.json'), JSON.stringify(raw, null, 2), 'utf8');

const csv = ['\uFEFF视频秒,时间码,字段,新值,说明/来源'];
timeline.events.forEach(function (e) {
  csv.push([e.t, V.formatTime(e.t), e.field, e.value, String(e.note || '').replace(/,/g, '，')].join(','));
});
fs.writeFileSync(path.join(root, 'BV19f4H6xE9B-时间轴对照.csv'), csv.join('\r\n'), 'utf8');

console.log('video:', timeline.video.title, '| P' + timeline.video.page, timeline.video.part, timeline.video.duration + 's');
console.log('events:', timeline.events.length, '| aligned:', aligned.events.length, '| absorbed:', aligned.absorbed);
console.log('duration:', options.duration, '| defs:', (code.match(/^def /gm) || []).length,
            '| chains:', (code.match(/^set /gm) || []).length, '| chars:', code.length);
console.log('files: BV19f4H6xE9B-完整计分.bas / 视频时间轴示例.json / BV19f4H6xE9B-时间轴对照.csv');
