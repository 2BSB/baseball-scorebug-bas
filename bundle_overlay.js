/* 把 scorebug-generator.js 与 relay-client.js 内联进直播叠加层模板，
 * 产出单文件 live-overlay.html：OBS 可直接加载本地文件，也可作为线上房间页打开。 */
const fs = require('fs');
const path = require('path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, '_refs', 'live_overlay_source.html'), 'utf8');
const files = ['scorebug-generator.js', 'relay-client.js',
               'cloud-sdk.global.js', 'cloud-config.js', 'cloud-sync.js'];
files.forEach(function (f) {
  const tag = '<script src="' + f + '"></script>';
  if (!html.includes(tag)) throw new Error('叠加层模板缺少 ' + f + ' 占位标签');
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  html = html.replace(tag, function () { return '<script>\n' + code + '\n</script>'; });
});
if (html.includes('<script src=')) throw new Error('叠加层仍有外链脚本');
const dest = path.join(root, 'live-overlay.html');
fs.writeFileSync(dest, html, 'utf8');
console.log('overlay bundled:', dest, Buffer.byteLength(html), 'bytes');
