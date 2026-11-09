/* v21 验证：半局单选项（上半局 ▲ / 下半局 ▼）是否在同一行、不换行 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, '棒球计分弹幕生成器.html'), 'utf8');
const inject = `
<script>
(function(){
  var out=[]; function p(k,v){ out.push(k+'='+v); }
  var pre=document.createElement('pre'); pre.id='VERIFY_OUT'; pre.textContent='pending';
  document.body.appendChild(pre);
  document.title='V21_RUNNING';
  try {
    document.querySelectorAll('.fold').forEach(function(f){ f.classList.add('open'); });
    var radios = document.querySelector('.fold[data-key="inning"] .radios');
    var row = radios.closest('.row');
    var labels = radios.querySelectorAll('label');
    var r = radios.getBoundingClientRect();
    p('radios_rect', [r.left,r.top,r.width,r.height].map(Math.round).join(','));
    p('radios_height', Math.round(r.height));
    labels.forEach(function(l,i){
      var b=l.getBoundingClientRect(), cs=getComputedStyle(l);
      p('label'+i, [l.textContent.trim(), b.left, b.top, b.width, b.height,
        'fs='+cs.fontSize, 'ws='+cs.whiteSpace, 'color='+cs.color,
        'scroll='+l.scrollWidth, 'client='+l.clientWidth]
        .map(function(x){ return typeof x==='number' ? Math.round(x) : x; }).join('|'));
    });
    var rowLabel = row.querySelector(':scope > label');
    p('row_label_width', Math.round(rowLabel.getBoundingClientRect().width));
    p('row_height', Math.round(row.getBoundingClientRect().height));
    p('fold_count', document.querySelectorAll('.fold.open').length);
  } catch(e) { p('ERROR', e.name + ': ' + e.message); }
  pre.textContent=out.join(String.fromCharCode(10));
  document.title='V21_DONE';
})();
</script>
`;
const check = path.join(__dirname, 'v21_layout_check.html');
fs.writeFileSync(check, html.replace('</body>', inject + '</body>'), 'utf8');

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const args = [
  '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--hide-scrollbars',
  '--user-data-dir=' + path.join(__dirname, 'chromeV21b'),
  '--window-size=1400,1000', '--virtual-time-budget=8000',
  '--dump-dom', pathToFileURL(check).href
];
const dom = execFileSync(chrome, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
fs.writeFileSync(path.join(__dirname, 'v21_dom.html'), dom, 'utf8');
console.log('title=' + (dom.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
const m = dom.match(/<pre id="VERIFY_OUT">([\s\S]*?)<\/pre>/);
if (!m) throw new Error('VERIFY_OUT not found in dumped DOM');
const text = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
console.log(text);

const lines = text.split('\n');
const get = k => (lines.find(l => l.startsWith(k + '=')) || '').slice(k.length + 1);
const l0 = get('label0').split('|'), l1 = get('label1').split('|');
const checks = {
  no_error: !text.includes('ERROR='),
  both_labels_present: lines.filter(l => /^label\d=/.test(l)).length === 2,
  same_top: +l0[2] === +l1[2],
  single_line_height: +l0[4] <= 26 && +l1[4] <= 26 && Math.abs(+l0[4] - +l1[4]) <= 1,
  no_text_wrap: /ws=nowrap/.test(get('label0')) && /ws=nowrap/.test(get('label1')),
  no_clipping: /scroll=(\d+)/.test(get('label0')) && /client=(\d+)/.test(get('label0')),
  radios_one_line: +get('radios_height') <= 26,
  row_title_width: +get('row_label_width') === 76,
  folds_expanded: +get('fold_count') >= 7
};
Object.keys(checks).forEach(k => console.log('CHECK ' + k + ' = ' + checks[k]));
if (Object.values(checks).some(v => !v)) throw new Error('layout check failed');
console.log('LAYOUT_OK');
