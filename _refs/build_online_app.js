/* 把构建好的单文件页面复制进线上服务的 public/ 目录。
 * 可用环境变量 RELAY_ORIGIN 把线上地址写进页面的默认中继输入框（仅线上副本）。 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'online-app', 'public');
fs.mkdirSync(out, { recursive: true });

const relay = (process.env.RELAY_ORIGIN || '').trim().replace(/\/+$/, '');
const pages = [
  ['棒球计分弹幕生成器.html', 'index.html'],
  ['live-overlay.html', 'live-overlay.html']
];
pages.forEach(function (pair) {
  let html = fs.readFileSync(path.join(root, pair[0]), 'utf8');
  if (relay) html = html.split('__RELAY_DEFAULT__').join(relay);
  fs.writeFileSync(path.join(out, pair[1]), html, 'utf8');
  console.log('online-app/public/' + pair[1], Buffer.byteLength(html), 'bytes');
});
fs.copyFileSync(path.join(root, 'reference-scoreboard.png'), path.join(out, 'reference-scoreboard.png'));
console.log('online-app/public/reference-scoreboard.png', fs.statSync(path.join(out, 'reference-scoreboard.png')).size, 'bytes');
console.log('relay_default=' + (relay || '(same-origin)'));
