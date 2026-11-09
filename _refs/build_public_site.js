/* 从主 HTML / 叠加层生成公网发布目录 public-site/：干净的静态网页 + 参考图。
 *
 * 两套能力按用途分开：
 *  - 线上应用（online-app/public/）保留线上房间中继与云服务代码块；
 *  - GitHub Pages 干净版（public-site/、docs/）彻底剔除云服务 SDK、配置、
 *    云端 UI 与云端逻辑，保持「零外链、零持久化、不主动联网」的隐私承诺。
 * 隐私检查：页面主体（除唯一允许联网的 relay-client 代码块外）不得含任何
 * 外链、持久化或网络请求代码；线上房间功能必须由用户点击「连接」才启动。 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public-site');
fs.mkdirSync(out, { recursive: true });

const RELAY_BLOCK = /\/\* RELAY-CLIENT-START \*\/[\s\S]*?\/\* RELAY-CLIENT-END \*\//g;
const CLOUD_BLOCKS = [
  [/<!-- CLOUD-ASSETS-START -->[\s\S]*?<!-- CLOUD-ASSETS-END -->/g, 'cloud assets'],
  [/<!-- CLOUD-UI-START -->[\s\S]*?<!-- CLOUD-UI-END -->/g, 'cloud ui'],
  [/\/\* CLOUD-LOGIC-START \*\/[\s\S]*?\/\* CLOUD-LOGIC-END \*\//g, 'cloud logic']
];
function stripRelay(html) {
  RELAY_BLOCK.lastIndex = 0;
  if (!RELAY_BLOCK.test(html)) throw new Error('未找到 relay-client 代码块标记，拒绝跳过隐私检查');
  RELAY_BLOCK.lastIndex = 0;
  return html.replace(RELAY_BLOCK, '/* relay-client omitted for privacy scan */');
}
function stripCloud(html) {
  let n = 0;
  CLOUD_BLOCKS.forEach(function (pair) {
    pair[0].lastIndex = 0;
    if (pair[0].test(html)) n++;
    pair[0].lastIndex = 0;
    html = html.replace(pair[0], '<!-- ' + pair[1] + ' omitted in static build -->');
  });
  return { html: html, removed: n };
}
function assertNoCloud(html, label) {
  if (/createWorkBuddyCloud|SCOREBUG_CLOUD_CONFIG|ScorebugCloud|cloud-sdk\.global|btnCloudSave/.test(html))
    throw new Error(label + ' 仍残留云服务代码，静态版剔除失败');
}
/* jQuery 内部带有惰性的 XMLHttpRequest 工厂（库代码，页面从不调用 $.ajax）；
 * 因此单独检查「没有任何 ajax 调用」，而不把库内部的类名算作页面网络请求。 */
const forbidden = /<script[^>]+src=|<link[^>]+href=|localStorage\s*\.|sessionStorage\s*\.|document\.cookie|indexedDB|sendBeacon|fetch\(|new WebSocket|navigator\.sendBeacon/;
const ajaxCall = /\$\s*\.\s*(ajax|get|post|getJSON|getScript)\s*\(|jQuery\s*\.\s*(ajax|get|post)\s*\(/;
const sample = /BV19f4H6xE9B|红钻|射射花|弹幕线索|马查多|SAMPLE_VIDEO|buildSampleTimeline/;

const srcHtml = fs.readFileSync(path.join(root, '棒球计分弹幕生成器.html'), 'utf8');
const srcOverlay = fs.readFileSync(path.join(root, 'live-overlay.html'), 'utf8');

const main = stripCloud(srcHtml);
const ov = stripCloud(srcOverlay);
if (main.removed < 3 || ov.removed < 3)
  throw new Error('云服务代码块标记数量异常，拒绝发布静态版：main=' + main.removed + ' overlay=' + ov.removed);
assertNoCloud(main.html, '主页面');
assertNoCloud(ov.html, '叠加层');

const mainBody = stripRelay(main.html);
const ovBody = stripRelay(ov.html);
if (forbidden.test(mainBody)) throw new Error('主 HTML 主体含外链/持久化/网络请求代码，请先检查');
if (ajaxCall.test(mainBody)) throw new Error('主 HTML 主体出现 jQuery ajax 调用，请先检查');
if (sample.test(srcHtml)) throw new Error('主 HTML 仍含示例视频/比赛数据，请先清理');
if (/<script[^>]+src=/.test(ov.html)) throw new Error('叠加层仍含外链脚本，请先执行 node bundle_overlay.js');
if (forbidden.test(ovBody)) throw new Error('叠加层主体含外链/持久化/网络请求代码，请先检查');
if (ajaxCall.test(ovBody)) throw new Error('叠加层主体出现 jQuery ajax 调用，请先检查');

fs.writeFileSync(path.join(out, 'index.html'), main.html, 'utf8');
fs.writeFileSync(path.join(out, 'live-overlay.html'), ov.html, 'utf8');
fs.copyFileSync(path.join(root, 'reference-scoreboard.png'), path.join(out, 'reference-scoreboard.png'));
console.log('public-site/index.html', Buffer.byteLength(main.html), 'bytes (cloud blocks removed: ' + main.removed + ')');
console.log('public-site/live-overlay.html', Buffer.byteLength(ov.html), 'bytes (cloud blocks removed: ' + ov.removed + ')');
console.log('public-site/reference-scoreboard.png', fs.statSync(path.join(out, 'reference-scoreboard.png')).size, 'bytes');
console.log('checks: no cloud code, no external script/link, no storage/network outside opt-in relay client, no sample data');
