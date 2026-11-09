/* 把线上分享链接写进各份单文件页面的默认「中继地址」（含 sharecode）。
 * 用法：RELAY_ORIGIN='https://xxx/?sharecode=yyy' node _refs/bake_relay.js
 * 重新执行 bundle.js / build_public_site.js 后需再跑一次。 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const relay = (process.env.RELAY_ORIGIN || '').trim();
if (!relay) { console.log('RELAY_ORIGIN 未设置，跳过写入（页面保持「当前站点」默认）'); process.exit(0); }

const files = [
  '棒球计分弹幕生成器.html',
  'public-site/index.html',
  'docs/index.html',
  'online-app/public/index.html'
];
files.forEach(function (f) {
  const p = path.join(root, f);
  let html = fs.readFileSync(p, 'utf8');
  const n = html.split('__RELAY_DEFAULT__').length - 1;
  if (n !== 1) throw new Error(f + ' 中的 __RELAY_DEFAULT__ 占位符数量异常：' + n);
  html = html.replace('__RELAY_DEFAULT__', relay);
  fs.writeFileSync(p, html, 'utf8');
  console.log('baked', f, Buffer.byteLength(html), 'bytes');
});
console.log('relay_default=' + relay);
