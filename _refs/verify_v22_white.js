/* v22 验证：B 字母在 BAS、SVG 预览、网页运行时输出中都必须是纯白 #FFFFFF */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, '棒球计分弹幕生成器.html'), 'utf8');

function staticCheck(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const block = (text.match(/def text tBallLabel \{[\s\S]*?\n\}/) || [''])[0];
  const color = (block.match(/color\s*=\s*(0x[0-9A-Fa-f]+)/) || [])[1];
  const ok = color === '0xFFFFFF' && !/DCEBFF/i.test(text);
  console.log('STATIC ' + file + ' tBallLabel=' + color + ' DCEBFF=' + /DCEBFF/i.test(text) + ' ok=' + ok);
  if (!ok) throw new Error('static check failed: ' + file);
}
['棒球实时计分.bas', '棒球实时计分-时间轴示例.bas', 'BV19f4H6xE9B-完整计分.bas'].forEach(staticCheck);
if (/DCEBFF/i.test(html)) throw new Error('main html still has blueWhite');

const inject = `
<script>
(function(){
  var out=[]; function p(k,v){ out.push(k+'='+v); }
  var pre=document.createElement('pre'); pre.id='VERIFY_OUT'; pre.textContent='pending';
  document.body.appendChild(pre);
  try {
    var code=document.getElementById('codeOut').value;
    var block=(code.match(/def text tBallLabel \\{[\\s\\S]*?\\n\\}/)||[''])[0];
    p('B_bas_color',(block.match(/color\\s*=\\s*(0x[0-9A-Fa-f]+)/)||[])[1]);
    var sBlock=(code.match(/def text tStrikeLabel \\{[\\s\\S]*?\\n\\}/)||[''])[0];
    p('S_bas_color',(sBlock.match(/color\\s*=\\s*(0x[0-9A-Fa-f]+)/)||[])[1]);
    p('code_len',code.length);
    var texts=document.querySelectorAll('#svgPreview text');
    var b=null,s=null;
    texts.forEach(function(t){ if(t.textContent==='B') b=t; if(t.textContent==='S') s=t; });
    p('B_svg_fill',b?b.getAttribute('fill'):'MISSING');
    p('S_svg_fill',s?s.getAttribute('fill'):'MISSING');
    p('DCEBFF_in_code',code.indexOf('DCE'+'BFF')>=0);
    p('DCEBFF_in_svg',document.getElementById('svgPreview').innerHTML.indexOf('DCE'+'BFF')>=0);
    p('script_src_count',document.querySelectorAll('script[src]').length);
  } catch(e){ p('ERROR',e.name+': '+e.message); }
  pre.textContent=out.join(String.fromCharCode(10));
})();
</script>
`;
const page = path.join(__dirname, 'v22_white_check.html');
fs.writeFileSync(page, html.replace('</body>', inject + '</body>'), 'utf8');
const dom = execFileSync('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
  '--hide-scrollbars', '--user-data-dir=' + path.join(__dirname, 'chromeV22'),
  '--window-size=1400,1000', '--virtual-time-budget=6000',
  '--dump-dom', pathToFileURL(page).href
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
const m = dom.match(/<pre id="VERIFY_OUT">([\s\S]*?)<\/pre>/);
if (!m) throw new Error('VERIFY_OUT missing');
const text = m[1].replace(/\r/g, '');
console.log(text);
const get = k => (text.split('\n').find(l => l.startsWith(k + '=')) || '').slice(k.length + 1);
const checks = {
  no_error: !text.includes('ERROR='),
  B_bas_white: get('B_bas_color') === '0xFFFFFF',
  S_bas_white: get('S_bas_color') === '0xFFFFFF',
  B_svg_white: get('B_svg_fill').toLowerCase() === '#ffffff',
  S_svg_white: get('S_svg_fill').toLowerCase() === '#ffffff',
  no_bluewhite_in_code: get('DCEBFF_in_code') === 'false',
  no_bluewhite_in_svg: get('DCEBFF_in_svg') === 'false',
  no_external_scripts: get('script_src_count') === '0'
};
Object.keys(checks).forEach(k => console.log('CHECK ' + k + ' = ' + checks[k]));
if (Object.values(checks).some(v => !v)) throw new Error('white check failed');
console.log('WHITE_OK');
