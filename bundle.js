/* 把依赖脚本内联进 HTML，生成单文件离线可用的生成器 */
const fs = require('fs');
const path = require('path');
const root = __dirname;
const out = path.join(root, '棒球计分弹幕生成器.html');
const backup = path.join(root, '_refs', 'generator_source.html');
const src = fs.existsSync(backup) ? backup : out;
let html = fs.readFileSync(src, 'utf8');
if (!html.includes('<script src="jquery.min.js"></script>')) {
  throw new Error('找不到未打包的模板（应包含外部 script 标签）');
}
if (src !== backup) fs.writeFileSync(backup, html, 'utf8');
const files = ['jquery.min.js', 'bas-engine.js', 'scorebug-generator.js', 'video-timeline.js'];
files.forEach(function (f) {
  const tag = '<script src="' + f + '"></script>';
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  // 用函数形式的 replacement，避免源码里的 $& / $' 被当成替换模板解析
  html = html.replace(tag, function () { return '<script>\n' + code + '\n</script>'; });
});
fs.writeFileSync(out, html, 'utf8');
console.log('bundled:', out, html.length, 'chars');
