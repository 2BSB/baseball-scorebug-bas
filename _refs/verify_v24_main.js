/* v24 主页面验证：字幕功能已彻底移除、格式下拉与线上控制可用、默认零网络请求。 */
const fs = require('fs');
const path = require('path');
const H = require('./cdp_helper');

const root = path.resolve(__dirname, '..');
const PORT = 9240;
const pageUrl = H.fileUrl(path.join(root, '棒球计分弹幕生成器.html'));

async function main() {
  let chrome = null, browser = null, page = null;
  try {
    chrome = H.launch(PORT, 'chromeV24main', 'about:blank');
    const version = await H.waitFor('http://127.0.0.1:' + PORT + '/json/version', 40, true);
    browser = await H.connect(version.webSocketDebuggerUrl);
    const targets = await H.waitFor('http://127.0.0.1:' + PORT + '/json/list', 40, true);
    const t = targets.find(function (x) { return x.type === 'page'; });
    page = await H.connect(t.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: pageUrl });
    await H.sleep(1800);

    const checks = await H.evalJS(page, `(function(){
      var q=function(s){return document.querySelector(s);};
      var code=q('#codeOut').value;
      return {
        title: document.title,
        script_src: document.querySelectorAll('script[src]').length,
        link_href: document.querySelectorAll('link[href]').length,
        subtitle_module: typeof window.ScorebugSubtitles,
        subtitle_buttons: document.querySelectorAll('#btnExportSrt,#btnExportVtt,#btnExportAss').length,
        subtitle_text: /导出字幕|SRT \\/ WebVTT|ScorebugSubtitles|btnExportSrt/.test(document.body.innerHTML),
        relay_module: typeof window.ScorebugRelay,
        burner_module: typeof window.ScorebugBurner,
        format_options: q('#burnFormat').options.length,
        format_default: q('#burnFormat').value,
        format_info: q('#formatInfo').textContent.slice(0, 60),
        overlay_link: q('#overlayLink').value,
        relay_status: q('#relayStatus').textContent,
        bas_chars: code.length,
        bas_has_def: /^def text/m.test(code),
        clean_css: !!document.querySelector('.local-tools')
      };
    })()`);
    const netRequests = page.events
      .filter(function (e) { return e.method === 'Network.requestWillBeSent'; })
      .map(function (e) { return e.params.request.url; })
      .filter(function (u) { return /^https?:/i.test(u); });
    const jsErrors = page.events.filter(function (e) { return e.method === 'Runtime.exceptionThrown'; }).length;

    console.log(JSON.stringify(checks, null, 2));
    console.log('network_http_requests=' + netRequests.length, netRequests.slice(0, 5));
    console.log('js_errors=' + jsErrors);

    const ok = checks.script_src === 0 && checks.link_href === 0 &&
      checks.subtitle_module === 'undefined' && checks.subtitle_buttons === 0 &&
      checks.subtitle_text === false && checks.relay_module === 'object' &&
      checks.burner_module === 'object' && checks.format_options >= 6 &&
      /live-overlay\.html\?room=/.test(checks.overlay_link) &&
      /^未连接/.test(checks.relay_status) && checks.bas_chars === 8979 &&
      checks.bas_has_def === true && netRequests.length === 0 && jsErrors === 0;
    console.log('MAIN_V24_OK=' + ok);
    if (!ok) process.exitCode = 1;
  } finally {
    [page, browser].forEach(function (c) { if (c) try { c.close(); } catch (e) {} });
    if (chrome) chrome.kill();
  }
}
main().catch(function (e) { console.error('MAIN_V24_FAIL', e.message); process.exitCode = 1; });
