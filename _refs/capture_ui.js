/* 为线上「棒球计分直播中控」按功能区截图。
 * 只在无头浏览器里注入演示数据用于展示，不修改任何线上/本地文件。 */
const fs = require('fs');
const path = require('path');
const H = require('./cdp_helper.js');

const root = path.resolve(__dirname, '..');
const OUT = path.join(root, '界面截图');
fs.mkdirSync(OUT, { recursive: true });
/* 只清理本脚本自己生成的 PNG，目录内不放其它文件 */
fs.readdirSync(OUT).forEach(function (f) {
  if (/\.png$/i.test(f)) { try { fs.unlinkSync(path.join(OUT, f)); } catch (e) {} }
});

const SHARE = '73BAOORXNH';
const BASE = 'https://scorebug-live-relay.app.workbuddy.host';
const MAIN = BASE + '/?sharecode=' + SHARE;
const G = require(path.join(root, 'scorebug-generator.js'));

const demoState = Object.assign({}, G.DEFAULT_STATE, {
  awayName: 'ARI', awayScore: 3, homeName: 'LAD', homeScore: 5,
  inning: 7, half: 'bottom', b1: 1, b2: 0, b3: 1,
  outs: 2, balls: 2, strikes: 1
});
const snapshot = encodeURIComponent(JSON.stringify({
  state: demoState, events: [], options: G.DEFAULT_OPTIONS,
  duration: 600, t: 0, room: 'DEMO01'
}));
const OVERLAY_PANEL = BASE + '/live-overlay.html?room=DEMO01&panel=1&clock=0&sharecode=' + SHARE + '#' + snapshot;
const OVERLAY_CLEAN = BASE + '/live-overlay.html?room=DEMO01&panel=0&clock=0&sharecode=' + SHARE + '#' + snapshot;

const DEMO_JS = `(function(){
  function setv(id,v){ var e=document.getElementById(id); if(!e) return;
    e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); }
  function setc(id,v){ var e=document.getElementById(id); if(!e) return;
    e.checked=v; e.dispatchEvent(new Event('change',{bubbles:true})); }
  document.querySelectorAll('.fold').forEach(function(f){
    f.classList.add('open'); var b=f.querySelector('.fold-head'); if(b) b.setAttribute('aria-expanded','true');
  });
  setv('awayName','ARI'); setv('awayScore','3'); setv('homeName','LAD'); setv('homeScore','5');
  setv('inning','7'); setv('balls','2'); setv('strikes','1'); setv('outs','2');
  setc('b1',true); setc('b2',false); setc('b3',true);
  var half=document.querySelector('input[name=half][value=bottom]');
  if(half){ half.checked=true; half.dispatchEvent(new Event('change',{bubbles:true})); }
  setv('previewTime','0');
  setv('roomId','DEMO01');
  var btn=document.getElementById('btnRefresh'); if(btn) btn.click();
  return {
    height: document.documentElement.scrollHeight,
    state: (document.getElementById('currentState')||{}).textContent || '',
    formats: Array.prototype.map.call(document.getElementById('burnFormat').options,function(o){return o.textContent;}),
    room: (document.getElementById('roomId')||{}).value || '',
    link: (document.getElementById('overlayLink')||{}).value || ''
  };
})()`;

const SIM_BG = `(function(){
  if(document.getElementById('__shot_bg')) return true;
  var d=document.createElement('div'); d.id='__shot_bg';
  d.style.cssText='position:fixed;inset:0;z-index:0;pointer-events:none;'+
    'background:radial-gradient(120% 90% at 30% 15%,#1c4b33 0%,#0c2a20 45%,#06131a 100%);'+
    'font:600 15px "Microsoft YaHei",sans-serif;color:rgba(255,255,255,.42);';
  d.innerHTML='<div style="position:absolute;left:80px;top:70px;letter-spacing:2px">'+
    '模拟直播画面（仅截图时叠加的示意背景，实际叠加层为全透明）</div>'+
    '<div style="position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);'+
    'width:62%;height:52%;border:1px dashed rgba(255,255,255,.16);border-radius:50% 50% 8px 8px"></div>';
  document.body.insertBefore(d, document.body.firstChild);
  return true;
})()`;

async function shot(conn, name, clip) {
  const params = { format: 'png', captureBeyondViewport: true };
  if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
  const r = await conn.send('Page.captureScreenshot', params);
  if (!r.result || !r.result.data) throw new Error('截图失败: ' + name + ' ' + JSON.stringify(r.error || {}));
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('saved', name, fs.statSync(file).size, 'bytes');
}

async function rectOf(conn, selector, pad) {
  pad = pad || 0;
  return await H.evalJS(conn, `(function(){
    var e=document.querySelector(${JSON.stringify(selector)});
    if(!e) return null;
    var r=e.getBoundingClientRect();
    return { x:Math.max(0,r.left+window.scrollX-${pad}), y:Math.max(0,r.top+window.scrollY-${pad}),
             width:r.width+${pad}*2, height:r.height+${pad}*2 };
  })()`);
}

async function openPage(url, port, profile, width, height) {
  const proc = H.launch(port, profile, url,
    ['--window-size=' + width + ',' + height, '--force-device-scale-factor=1']);
  await H.waitFor('http://127.0.0.1:' + port + '/json/version', 50, true);
  let page = null;
  for (var i = 0; i < 40 && !page; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      page = list.find(function (t) { return t.type === 'page' && t.url.indexOf('scorebug-live-relay') >= 0; });
    } catch (e) {}
    if (!page) await H.sleep(250);
  }
  if (!page) throw new Error('找不到页面 target: ' + url);
  const conn = await H.connect(page.webSocketDebuggerUrl);
  await conn.send('Page.enable');
  await conn.send('Runtime.enable');
  await conn.send('Emulation.setDeviceMetricsOverride',
    { width: width, height: height, deviceScaleFactor: 1, mobile: false });
  await H.sleep(3200);
  return { proc: proc, conn: conn };
}

async function main() {
  let ctx = null;
  try {
    ctx = await openPage(MAIN, 9351, 'chromeShotUI', 1500, 1000);
    const conn = ctx.conn;
    /* 首屏保持页面默认状态（折叠组收起、未连接），与用户实际打开时一致 */
    await shot(conn, '02-打开页面首屏.png', { x: 0, y: 0, width: 1500, height: 1000 });
    const info = await H.evalJS(conn, DEMO_JS);
    await H.sleep(700);
    console.log('demo=', JSON.stringify(info));

    const fullH = Math.min(Math.max(info.height + 30, 1100), 7600);
    await conn.send('Emulation.setDeviceMetricsOverride',
      { width: 1500, height: fullH, deviceScaleFactor: 1, mobile: false });
    await H.sleep(1100);

    await shot(conn, '01-整体界面-全页长图.png');

    const regions = [
      ['03-效果预览与记分条.png', 'section.video-card', 14],
      ['04-记分条特写.png', '#stage', 10],
      ['05-比赛数据-全部展开.png', '#dataSection', 12],
      ['06-直播控制与视频导出.png', 'section.local-tools', 14]
    ];
    for (const [name, selector, pad] of regions) {
      const r = await rectOf(conn, selector, pad);
      if (!r) { console.log('missing', selector); continue; }
      await shot(conn, name, r);
    }

    /* 把 select 临时变成列表框，真实显示浏览器识别到的全部导出格式 */
    await H.evalJS(conn,
      "(function(){var e=document.getElementById('burnFormat');e.size=Math.max(3,e.options.length);return e.options.length;})()");
    await H.sleep(350);
    const r5 = await rectOf(conn, 'section.local-tools', 14);
    await shot(conn, '07-视频导出格式选项.png', r5);
    await H.evalJS(conn,
      "(function(){var e=document.getElementById('burnFormat');e.removeAttribute('size');return true;})()");
    await H.sleep(250);

    /* 时间轴 + BAS 代码输出 */
    const r6 = await rectOf(conn, '#timelineSection', 12);
    if (r6) await shot(conn, '08-实时计分轴与打点.png', r6);
    const r7 = await rectOf(conn, '.code-section', 12);
    if (r7) await shot(conn, '09-BAS代码输出.png', r7);

    conn.close();
    ctx.proc.kill();
    ctx = null;
    await H.sleep(500);

    /* 叠加层：带控制面板 */
    ctx = await openPage(OVERLAY_PANEL, 9352, 'chromeShotOverlay', 1920, 1080);
    await H.evalJS(ctx.conn, SIM_BG);
    await H.sleep(900);
    await shot(ctx.conn, '10-线上叠加层-控制面板.png');
    ctx.conn.close(); ctx.proc.kill(); ctx = null;
    await H.sleep(500);

    /* 叠加层：OBS 纯净输出（面板隐藏 + 示意画面） */
    ctx = await openPage(OVERLAY_CLEAN, 9353, 'chromeShotClean', 1920, 1080);
    await H.evalJS(ctx.conn, SIM_BG);
    await H.sleep(900);
    await shot(ctx.conn, '11-OBS输出记分条示意.png');
    console.log('DONE');
  } finally {
    if (ctx) { try { ctx.conn.close(); } catch (e) {} try { ctx.proc.kill(); } catch (e) {} }
  }
}
main().catch(function (e) { console.error('FAILED', e && e.stack || e); process.exit(1); });
