/* v24 多人场景（真实跨设备模拟）：两个独立浏览器实例 + 随机房间。
 * 控制器在实例 A（相当于主播电脑），叠加层在实例 B（相当于 OBS 机器），
 * 两者不共享 BroadcastChannel 存储分区，因此状态必须经线上中继才能到达。
 * 另外断言叠加层的数据源标签是「线上房间」，排除 URL 快照 / 同源广播造成的假阳性。
 * 可用 SITE 环境变量指向已部署的线上服务复测。 */
const path = require('path');
const { spawn } = require('child_process');
const H = require('./cdp_helper');

const root = path.resolve(__dirname, '..');
const PORT = 9243;
const CDP_CTRL = 9244, CDP_VIEW = 9245;
const SITE_URL = new URL(process.env.SITE || ('http://127.0.0.1:' + PORT));
const BASE = SITE_URL.origin;
const TICKET = SITE_URL.searchParams.get('sharecode') || '';
function siteUrl(pathname, query) {
  var q = query || '';
  if (TICKET) q += (q ? '&' : '') + 'sharecode=' + encodeURIComponent(TICKET);
  return BASE + pathname + (q ? '?' + q : '');
}
function randRoom() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
const ROOM_A = randRoom(), ROOM_B = randRoom();

function labels(conn) {
  return H.evalJS(conn,
    "Array.prototype.map.call(document.querySelectorAll('#overlay text'),function(t){return t.textContent;}).join('|')");
}
function link(conn) { return H.evalJS(conn, "document.getElementById('linkInfo').textContent"); }
function status(conn) { return H.evalJS(conn, "document.getElementById('relayStatus').textContent"); }
function source(conn) { return H.evalJS(conn, "document.getElementById('srcInfo').textContent"); }
async function setTeam(conn, name) {
  return H.evalJS(conn, "(function(){var e=document.getElementById('awayName');e.value=" + JSON.stringify(name) +
    ";e.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('btnOverlaySync').click();return e.value;})()");
}
async function openBrowser(port, name, urls) {
  const chrome = H.launch(port, name, 'about:blank');
  const version = await H.waitFor('http://127.0.0.1:' + port + '/json/version', 40, true);
  const browser = await H.connect(version.webSocketDebuggerUrl);
  for (const u of urls) await browser.send('Target.createTarget', { url: u });
  await H.sleep(2200);
  const targets = await H.waitFor('http://127.0.0.1:' + port + '/json/list', 30, true);
  const pages = targets.filter(function (t) { return t.type === 'page' && t.url !== 'about:blank'; });
  return { chrome: chrome, browser: browser, pages: pages };
}
async function findByRoom(env, room, isMain) {
  for (const t of env.pages) {
    const c = await H.connect(t.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    const v = await H.evalJS(c, isMain ? "document.getElementById('roomId').value" : "document.getElementById('roomInput').value");
    if (String(v).toUpperCase() === room) return c;
    c.close();
  }
  throw new Error('page missing for room ' + room + ' in ' + env.pages.map(function (x) { return x.url; }).join(' | '));
}

async function main() {
  let server = null, ctrlEnv = null, viewEnv = null;
  const conns = [];
  try {
    if (!process.env.SITE) {
      server = spawn(process.execPath, ['server.js'], {
        cwd: path.join(root, 'online-app'),
        env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore'
      });
      const probe = await H.waitFor(siteUrl('/api/health'), 40, true);
      console.log('server_health=' + JSON.stringify(probe));
    }
    console.log('rooms=' + ROOM_A + ',' + ROOM_B);
    /* 显式指定 relay，避免本地测试被页面里烘焙的线上默认地址抢走控制器 */
    const relayParam = '&relay=' + encodeURIComponent(BASE);
    ctrlEnv = await openBrowser(CDP_CTRL, 'chromeV24ctrl', [
      siteUrl('/', 'room=' + ROOM_A + relayParam),
      siteUrl('/', 'room=' + ROOM_B + relayParam)
    ]);
    viewEnv = await openBrowser(CDP_VIEW, 'chromeV24view', [
      siteUrl('/live-overlay.html', 'room=' + ROOM_A + '&clock=0'),
      siteUrl('/live-overlay.html', 'room=' + ROOM_B + '&clock=0')
    ]);
    const ctrlA = await findByRoom(ctrlEnv, ROOM_A, true); conns.push(ctrlA);
    const ctrlB = await findByRoom(ctrlEnv, ROOM_B, true); conns.push(ctrlB);
    const ovA = await findByRoom(viewEnv, ROOM_A, false); conns.push(ovA);
    const ovB = await findByRoom(viewEnv, ROOM_B, false); conns.push(ovB);
    console.log('independent_browsers=2 ctrl_pages=' + ctrlEnv.pages.length + ' view_pages=' + viewEnv.pages.length);

    await H.evalJS(ctrlA, "document.getElementById('btnRelayConnect').click()");
    await H.evalJS(ctrlB, "document.getElementById('btnRelayConnect').click()");
    await H.sleep(1800);
    const linkA = await link(ovA), linkB = await link(ovB);
    const statusA = await status(ctrlA), statusB = await status(ctrlB);
    console.log('overlayA_link=' + linkA);
    console.log('overlayB_link=' + linkB);
    console.log('ctrlA_status=' + statusA);
    console.log('ctrlB_status=' + statusB);

    await setTeam(ctrlA, 'ALPHA_TEAM');
    await H.sleep(1000);
    const afterA = { a: await labels(ovA), b: await labels(ovB) };
    const srcA = await source(ovA);
    await setTeam(ctrlB, 'BETA_TEAM');
    await H.sleep(1000);
    const afterB = { a: await labels(ovA), b: await labels(ovB) };
    const srcB = await source(ovB);
    await setTeam(ctrlA, 'GAMMA_TEAM');
    await H.sleep(1000);
    const afterC = { a: await labels(ovA), b: await labels(ovB) };
    console.log('overlayA_source=' + srcA);
    console.log('overlayB_source=' + srcB);
    console.log('afterA_A=' + afterA.a.slice(0, 90), 'afterA_B=' + afterA.b.slice(0, 90));
    console.log('afterB_A=' + afterB.a.slice(0, 90), 'afterB_B=' + afterB.b.slice(0, 90));
    console.log('afterC_A=' + afterC.a.slice(0, 90), 'afterC_B=' + afterC.b.slice(0, 90));

    const connected = /已连接/.test(linkA) && /已连接/.test(linkB) &&
      /已连接/.test(statusA) && /已连接/.test(statusB) &&
      !/控制密钥不匹配|失败|错误/.test(statusA + statusB);
    const viaRelay = /数据源：线上房间 /.test(srcA) && /数据源：线上房间 /.test(srcB);
    const noCrossA = /ALPHA_TEAM/.test(afterA.a) && !/ALPHA_TEAM/.test(afterA.b);
    const noCrossB = /BETA_TEAM/.test(afterB.b) && !/BETA_TEAM/.test(afterB.a) && /ALPHA_TEAM/.test(afterB.a);
    const noCrossC = /GAMMA_TEAM/.test(afterC.a) && !/GAMMA_TEAM/.test(afterC.b) && /BETA_TEAM/.test(afterC.b);
    console.log('connected=' + connected, 'via_online_relay=' + viaRelay,
      'no_cross_A=' + noCrossA, 'no_cross_B=' + noCrossB, 'no_cross_C=' + noCrossC);
    const ok = connected && viaRelay && noCrossA && noCrossB && noCrossC;
    console.log('BROWSER_MULTIUSER_OK=' + ok);
    if (!ok) process.exitCode = 1;
  } finally {
    conns.forEach(function (c) { try { c.close(); } catch (e) {} });
    [ctrlEnv, viewEnv].forEach(function (e) {
      if (!e) return;
      try { e.browser.close(); } catch (x) {}
      e.chrome.kill();
    });
    if (server) server.kill();
  }
}
main().catch(function (e) { console.error('BROWSER_V24_FAIL', e.message); process.exitCode = 1; });
