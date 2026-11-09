/* 公网复测：直接访问已发布页面，确认云服务功能真的上线。 */
const H = require('./cdp_helper.js');
const PORT = 9363;
const SHARE = '73BAOORXNH';
const BASE = 'https://scorebug-live-relay.app.workbuddy.host';
const SITE = BASE + '/?sharecode=' + SHARE;
const stamp = Date.now().toString(36).toUpperCase();
const ROOM = ('ONL' + stamp.slice(-7)).replace(/[^A-Z0-9]/g, '');
const OTHER = ('OTH' + stamp.slice(-7)).replace(/[^A-Z0-9]/g, '');

async function main() {
  const proc = H.launch(PORT, 'chromeCloudOnline', SITE, ['--window-size=1400,900']);
  let conn = null;
  try {
    await H.waitFor('http://127.0.0.1:' + PORT + '/json/version', 50, true);
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const page = list.find(function (t) { return t.type === 'page' && t.url.indexOf('scorebug-live-relay') >= 0; });
    if (!page) throw new Error('page target not found');
    conn = await H.connect(page.webSocketDebuggerUrl);
    await conn.send('Page.enable'); await conn.send('Runtime.enable');
    await H.sleep(3000);

    const main = await H.evalJS(conn, `JSON.stringify({
      url: location.href,
      cloud: typeof window.ScorebugCloud,
      ready: window.ScorebugCloud ? window.ScorebugCloud.status().ready : false,
      saveBtn: !!document.getElementById('btnCloudSave'),
      loadBtn: !!document.getElementById('btnCloudLoad'),
      scripts: document.querySelectorAll('script[src]').length,
      title: document.title
    })`);
    console.log('main=' + main);

    await H.evalJS(conn, `(function(){
      function set(id,v){ var e=document.getElementById(id); e.value=v;
        e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); }
      set('roomId', ${JSON.stringify(ROOM)});
      set('homeName', 'ONLINE'); set('homeScore', '7'); set('awayScore', '2');
      document.getElementById('btnCloudSave').click();
      return true;
    })()`);
    await H.sleep(3200);
    console.log('cloud_status=' + await H.evalJS(conn, '(document.getElementById("cloudStatus")||{}).textContent'));

    await conn.send('Page.navigate', { url: BASE + '/live-overlay.html?room=' + ROOM + '&panel=1&clock=0&sharecode=' + SHARE });
    await H.sleep(3400);
    console.log('overlay=' + await H.evalJS(conn, `JSON.stringify({
      cloud: typeof window.ScorebugCloud,
      cloudInfo: (document.getElementById('cloudInfo')||{}).textContent||'',
      srcInfo: (document.getElementById('srcInfo')||{}).textContent||'',
      restored: ((document.getElementById('overlay')||{}).textContent||'').indexOf('ONLINE')>=0,
      scripts: document.querySelectorAll('script[src]').length
    })`));

    await conn.send('Page.navigate', { url: BASE + '/live-overlay.html?room=' + OTHER + '&panel=1&clock=0&sharecode=' + SHARE });
    await H.sleep(2600);
    console.log('other_room=' + await H.evalJS(conn, `JSON.stringify({
      cloudInfo: (document.getElementById('cloudInfo')||{}).textContent||'',
      leaked: ((document.getElementById('overlay')||{}).textContent||'').indexOf('ONLINE')>=0
    })`));
    console.log('rooms_to_cleanup=' + JSON.stringify([ROOM]));
  } finally {
    if (conn) { try { conn.close(); } catch (e) {} }
    try { proc.kill(); } catch (e) {}
  }
}
main().catch(function (e) { console.error('FAILED', e && e.stack || e); process.exit(1); });
