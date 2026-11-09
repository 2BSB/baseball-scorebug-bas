/* v26 验证：三份页面都带作者信息与反馈入口、无外链脚本、无 JS 异常；
 * 干净静态版不含云代码；叠加层（OBS 输出）不显示作者信息，避免污染直播画面。
 * 同时把页脚截图保存到 界面截图/12-作者信息与页脚.png。 */
const fs = require('fs');
const path = require('path');
const H = require('./cdp_helper');

const root = path.resolve(__dirname, '..');
const PORT = 9271;
const BILI = 'https://space.bilibili.com/150585';
const ISSUES = 'https://github.com/2BSB/baseball-scorebug-bas/issues';

const EXPR = `(function(){
  var q=function(s){return document.querySelector(s);};
  var bar=q('.author-bar'), ft=q('footer.about');
  var links=[].slice.call(document.querySelectorAll('footer.about a')).map(function(a){return a.getAttribute('href');});
  var rect=ft?ft.getBoundingClientRect():null;
  return {
    title: document.title,
    authorBar: !!bar,
    authorText: bar ? bar.textContent.replace(/\\s+/g,' ').trim() : '',
    footer: !!ft,
    footerVisible: !!rect && rect.height > 20,
    footerText: ft ? ft.textContent.replace(/\\s+/g,' ').trim() : '',
    hrefs: links,
    scriptSrc: document.querySelectorAll('script[src]').length,
    cloudCode: document.documentElement.outerHTML.indexOf('createWorkBuddyCloud') >= 0,
    codeLen: q('#codeOut') ? q('#codeOut').value.length : 0,
    footerBottomGap: rect ? Math.round(document.documentElement.scrollHeight - (rect.bottom + window.scrollY)) : -1
  };
})()`;

const CASES = [
  ['主工具（含云服务）', '棒球计分弹幕生成器.html', true],
  ['GitHub Pages 干净静态版', 'docs/index.html', false],
  ['线上应用副本', 'online-app/public/index.html', true]
];

async function main() {
  const chrome = H.launch(PORT, 'chromeV26author', 'about:blank');
  let failed = 0;
  try {
    const version = await H.waitFor('http://127.0.0.1:' + PORT + '/json/version', 40, true);
    const browser = await H.connect(version.webSocketDebuggerUrl);
    const targets = await H.waitFor('http://127.0.0.1:' + PORT + '/json/list', 40, true);
    const target = targets.find(function (x) { return x.type === 'page'; });
    const page = await H.connect(target.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Log.enable');

    for (const item of CASES) {
      const label = item[0], file = item[1], expectCloud = item[2];
      page.events.length = 0;
      await page.send('Page.navigate', { url: H.fileUrl(path.join(root, file)) });
      await H.sleep(1600);
      const r = await H.evalJS(page, EXPR);
      const errs = page.events.filter(function (e) { return e.method === 'Runtime.exceptionThrown'; });
      const ok = [];
      const check = function (name, cond, extra) {
        ok.push((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra === undefined ? '' : ' (' + extra + ')'));
        if (!cond) failed++;
      };
      check('作者栏存在且含作者名', r.authorBar && r.authorText.indexOf('狗王IB') >= 0);
      check('页脚可见且含反馈说明', r.footer && r.footerVisible && r.footerText.indexOf('B 站后台私信') >= 0);
      check('B 站主页链接', r.hrefs.indexOf(BILI) >= 0);
      check('GitHub Issues 链接', r.hrefs.indexOf(ISSUES) >= 0);
      check('零外链脚本', r.scriptSrc === 0, r.scriptSrc);
      check('BAS 代码已生成', r.codeLen > 500, r.codeLen);
      check('云代码与版本一致', r.cloudCode === expectCloud, 'cloud=' + r.cloudCode);
      check('页脚位于页面底部', r.footerBottomGap >= 0 && r.footerBottomGap < 120, r.footerBottomGap);
      check('无 JS 异常', errs.length === 0, errs.length);
      console.log('\n[' + label + '] ' + file);
      ok.forEach(function (x) { console.log('  ' + x); });

      if (label === 'GitHub Pages 干净静态版') {
        await H.evalJS(page, "document.querySelector('footer.about').scrollIntoView({block:'center'})");
        await H.sleep(300);
        const shot = await page.send('Page.captureScreenshot', { format: 'png' });
        const dest = path.join(root, '界面截图', '12-作者信息与页脚.png');
        fs.writeFileSync(dest, Buffer.from(shot.result.data, 'base64'));
        console.log('  截图: ' + dest);
      }
    }

    const ov = fs.readFileSync(path.join(root, 'live-overlay.html'), 'utf8');
    const ovClean = fs.readFileSync(path.join(root, 'docs', 'live-overlay.html'), 'utf8');
    const noAuthor = ov.indexOf('狗王IB') < 0 && ovClean.indexOf('狗王IB') < 0;
    console.log('\n[叠加层] ' + (noAuthor ? 'PASS' : 'FAIL') + ' 不含作者信息（不污染 OBS 画面）');
    if (!noAuthor) failed++;

    page.close(); browser.close();
  } finally {
    chrome.kill();
  }
  console.log('\n结果: ' + (failed === 0 ? '全部通过' : failed + ' 项失败'));
  if (failed) process.exit(1);
}
main().catch(function (e) { console.error(e); process.exit(1); });
