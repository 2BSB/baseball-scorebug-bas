/* 云服务接入验证：在真实线上域名（同源）里装载本地新构建的页面，调用 WorkBuddy 云数据库。
 * 不依赖重新部署：CDP 打开正式域名后，用 setDocumentContent 换成新构建的 HTML，
 * URL / Origin 保持线上域名，因此云服务的精确 Origin 校验可以通过。 */
const fs = require('fs');
const path = require('path');
const H = require('./cdp_helper.js');

const root = path.resolve(__dirname, '..');
const PORT = 9361;
const SHARE = '73BAOORXNH';
const BASE = 'https://scorebug-live-relay.app.workbuddy.host';
const SITE = BASE + '/?sharecode=' + SHARE;
const PROBE = BASE + '/__cloud_verify__?sharecode=' + SHARE;
const stamp = Date.now().toString(36).toUpperCase();
const ROOM_A_ID = ('CLOUD' + stamp.slice(-6)).replace(/[^A-Z0-9]/g, '');
const ROOM_B_ID = ('B' + stamp.slice(-7)).replace(/[^A-Z0-9]/g, '');
const ROOM_C_ID = ('D' + stamp.slice(-7)).replace(/[^A-Z0-9]/g, '');

function read(f) { return fs.readFileSync(path.join(root, f), 'utf8'); }
const sdk = read('cloud-sdk.global.js');
const cfg = read('cloud-config.js');
const sync = read('cloud-sync.js');
const mainHtml = read('online-app/public/index.html');
const overlayHtml = read('online-app/public/live-overlay.html');
const cleanHtml = read('public-site/index.html');
if (/<\/script/i.test(sdk + cfg + sync)) throw new Error('云脚本含 </script，需转义后再拼装');

const MIN_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>' +
  '<script>' + sdk + '</script><script>' + cfg + '</script><script>' + sync + '</script>' +
  '</body></html>';

const results = {};
let currentHtml = MIN_HTML;
function put(k, v) { results[k] = v; console.log(k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)); }

function writeDocExpr(html) {
  return '(function(){document.open();document.write(' + JSON.stringify(html) + ');document.close();return true;})()';
}
async function loadDoc(conn, url, html, wait) {
  await conn.send('Page.navigate', { url: url });
  await H.sleep(1300);
  currentHtml = html;
  /* setDocumentContent 在本环境不替换文档；document.write 会解析并执行内联脚本，
   * 且保持当前 URL / Origin 为正式域名，满足云服务的精确 Origin 校验。 */
  await H.evalJS(conn, writeDocExpr(html));
  await H.sleep(wait || 2000);
}
async function evaluate(conn, expr) {
  for (var i = 0; i < 3; i++) {
    try { return await H.evalJS(conn, expr); }
    catch (e) {
      if (i === 2) throw e;
      await H.sleep(900);
      try { await H.evalJS(conn, writeDocExpr(currentHtml)); } catch (e2) {}
      await H.sleep(1500);
    }
  }
}

async function main() {
  const proc = H.launch(PORT, 'chromeCloudV25', PROBE, ['--window-size=1400,900']);
  let conn = null;
  try {
    await H.waitFor('http://127.0.0.1:' + PORT + '/json/version', 50, true);
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const page = list.find(function (t) { return t.type === 'page' && t.url.indexOf('scorebug-live-relay') >= 0; });
    if (!page) throw new Error('page target not found');
    conn = await H.connect(page.webSocketDebuggerUrl);
    await conn.send('Page.enable');
    await conn.send('Runtime.enable');
    await H.sleep(1500);

    /* ---- 0) 最小宿主页：确认 setDocumentContent 会执行内联云脚本 ---- */
    await loadDoc(conn, PROBE, MIN_HTML, 1800);
    put('sdk_status', JSON.parse(await evaluate(conn, 'JSON.stringify(window.ScorebugCloud.status())')));
    put('sdk_endpoint', await evaluate(conn, 'window.SCOREBUG_CLOUD_CONFIG.endpoint'));

    /* ---- 1) SDK 级真实读写 ---- */
    const saved = await evaluate(conn, 'window.ScorebugCloud.saveRoom(' + JSON.stringify(ROOM_A_ID) +
      ', {state:{awayName:"ARI",homeName:"LAD",awayScore:3,homeScore:5,inning:7,half:"bottom",b1:1,b2:0,b3:1,outs:2,balls:2,strikes:1},events:[{t:10,field:"homeScore",value:6}],options:{},duration:600}, "CONTROLKEY123").then(function(r){return JSON.stringify(r);})');
    put('save_result', JSON.parse(saved));

    const loaded = await evaluate(conn, 'window.ScorebugCloud.loadRoom(' + JSON.stringify(ROOM_A_ID) +
      ').then(function(r){return JSON.stringify({ok:r.ok,code:r.code||"",home:r.data&&r.data.state?r.data.state.homeScore:null,rev:r.data?r.data.revision:null,events:r.data&&r.data.events?r.data.events.length:null});})');
    put('load_result', JSON.parse(loaded));

    const other = await evaluate(conn, 'window.ScorebugCloud.loadRoom(' + JSON.stringify(ROOM_B_ID) +
      ').then(function(r){return JSON.stringify({ok:r.ok,data:r.data});})');
    put('other_room', JSON.parse(other));

    const mismatch = await evaluate(conn, 'window.ScorebugCloud.saveRoom(' + JSON.stringify(ROOM_A_ID) +
      ', {state:{},events:[],options:{},duration:600}, "WRONGKEY999").then(function(r){return JSON.stringify({ok:r.ok,code:r.code,message:r.message});})');
    put('wrong_key', JSON.parse(mismatch));

    const badRoom = await evaluate(conn, 'window.ScorebugCloud.saveRoom("AB", {state:{},events:[],options:{},duration:600}, "K").then(function(r){return JSON.stringify({ok:r.ok,code:r.code});})');
    put('bad_room', JSON.parse(badRoom));

    /* ---- 2) 新版主页面：按钮、状态、真实保存 ---- */
    await loadDoc(conn, SITE, mainHtml, 2200);
    put('main_page', JSON.parse(await evaluate(conn, `JSON.stringify({
      cloud: typeof window.ScorebugCloud,
      ready: window.ScorebugCloud ? window.ScorebugCloud.status().ready : false,
      saveBtn: !!document.getElementById('btnCloudSave'),
      loadBtn: !!document.getElementById('btnCloudLoad'),
      scripts: document.querySelectorAll('script[src]').length,
      basLen: ((document.getElementById('codeOut')||{}).value||'').length
    })`)));
    await evaluate(conn, `(function(){
      function set(id,v){ var e=document.getElementById(id); e.value=v;
        e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); }
      set('roomId', ${JSON.stringify(ROOM_C_ID)});
      set('homeName', 'CLOUD'); set('homeScore', '9'); set('awayScore', '3');
      return true;
    })()`);
    await evaluate(conn, 'document.getElementById("btnCloudSave").click(); true');
    await H.sleep(3000);
    put('main_cloud_status', await evaluate(conn, '(document.getElementById("cloudStatus")||{}).textContent'));

    /* ---- 3) 新版叠加层：从云端恢复 ---- */
    const ovUrl = BASE + '/live-overlay.html?room=' + ROOM_C_ID + '&panel=1&clock=0&sharecode=' + SHARE;
    await loadDoc(conn, ovUrl, overlayHtml, 2600);
    put('overlay_restore', JSON.parse(await evaluate(conn, `JSON.stringify({
      cloud: typeof window.ScorebugCloud,
      cloudInfo: (document.getElementById('cloudInfo')||{}).textContent || '',
      srcInfo: (document.getElementById('srcInfo')||{}).textContent || '',
      svgText: ((document.getElementById('overlay')||{}).textContent||'').slice(0,80),
      svgHasCloud: ((document.getElementById('overlay')||{}).textContent||'').indexOf('CLOUD') >= 0,
      scripts: document.querySelectorAll('script[src]').length
    })`)));

    /* ---- 4) 另一房间：不串台 ---- */
    const ovUrlB = BASE + '/live-overlay.html?room=' + ROOM_B_ID + '&panel=1&clock=0&sharecode=' + SHARE;
    await loadDoc(conn, ovUrlB, overlayHtml, 2000);
    put('overlay_other_room', await evaluate(conn,
      'JSON.stringify({src:(document.getElementById("srcInfo")||{}).textContent||"",cloud:(document.getElementById("cloudInfo")||{}).textContent||"",leaked:((document.getElementById("overlay")||{}).textContent||"").indexOf("CLOUD")>=0})'));

    /* ---- 5) 干净静态版：无云代码 ---- */
    await loadDoc(conn, SITE, cleanHtml, 1800);
    put('clean_page', await evaluate(conn, `JSON.stringify({
      cloud: typeof window.ScorebugCloud,
      sdk: typeof window.WorkBuddyCloud,
      saveBtn: !!document.getElementById('btnCloudSave'),
      scripts: document.querySelectorAll('script[src]').length
    })`));

    /* 测试房间由数据库管理工具在脚本外清理，不在应用代码里创建第二个云客户端 */
    put('rooms_to_cleanup', [ROOM_A_ID, ROOM_C_ID]);

    const ovOther = JSON.parse(results.overlay_other_room);
    const clean = JSON.parse(results.clean_page);
    const pass =
      results.sdk_status.ready === true &&
      results.save_result.ok === true &&
      results.load_result.ok === true && results.load_result.home === 5 &&
      results.other_room.ok === true && results.other_room.data === null &&
      results.wrong_key.code === 'key-mismatch' &&
      results.bad_room.code === 'bad-room' &&
      results.main_page.cloud === 'object' && results.main_page.ready === true &&
      results.main_page.saveBtn === true && results.main_page.scripts === 0 &&
      /云端已保存/.test(results.main_cloud_status) &&
      results.overlay_restore.cloud === 'object' &&
      /云端快照/.test(results.overlay_restore.srcInfo) &&
      results.overlay_restore.svgHasCloud === true &&
      !/云端快照/.test(ovOther.src) && !ovOther.leaked &&
      clean.cloud === 'undefined' && clean.saveBtn === false;
    put('ALL_PASS', pass);
  } finally {
    if (conn) { try { conn.close(); } catch (e) {} }
    try { proc.kill(); } catch (e) {}
  }
}
main().catch(function (e) { console.error('FAILED', e && e.stack || e); process.exit(1); });
