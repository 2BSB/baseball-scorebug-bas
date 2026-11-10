/* 把 scorebug-generator.js 与 relay-client.js 内联进手机控制页模板，
 * 产出零外链的单文件 mobile-control.html，并同步到线上服务 public/ 目录。
 * 手机控制页只依赖同源的 /api/rooms、/api/state 与 /ws / /api/push|poll，
 * 不内联云 SDK：接管房间时由 /api/state 读取最后一次状态。 */
const fs = require('fs');
const path = require('path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, '_refs', 'mobile_control_source.html'), 'utf8');
const files = ['scorebug-generator.js', 'relay-client.js'];
files.forEach(function (f) {
  const tag = '<script src="' + f + '"></script>';
  if (!html.includes(tag)) throw new Error('手机控制页模板缺少 ' + f + ' 占位标签');
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  html = html.replace(tag, function () { return '<script>\n' + code + '\n</script>'; });
});
if (/<script[^>]+src=|<link[^>]+href=/.test(html)) throw new Error('手机控制页仍有外链脚本 / 样式');
if (html.indexOf('RELAY-CLIENT-START') < 0) throw new Error('relay-client 代码块标记缺失');
if (html.indexOf('狗王IB') < 0) throw new Error('作者信息缺失');

const dest = path.join(root, 'mobile-control.html');
fs.writeFileSync(dest, html, 'utf8');
const online = path.join(root, 'online-app', 'public', 'mobile-control.html');
fs.mkdirSync(path.dirname(online), { recursive: true });
fs.copyFileSync(dest, online);
console.log('mobile-control.html', Buffer.byteLength(html), 'bytes');
console.log('online-app/public/mobile-control.html 已同步');
console.log('checks: 0 external script/link, relay-client inlined, author info kept');
