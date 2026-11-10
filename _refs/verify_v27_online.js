/* v2.7 公网复测：重新部署后，直接访问线上应用验证移动端控制页与跨设备房间中继。
 * 覆盖：页面/接口可访问、sharecode 透传、零外链脚本、触摸改比分与队名、
 * 同房间叠加层实时更新、另一房间不串台、/api/rooms 与 /api/state、无未捕获异常。
 * 用 3 个独立 Chrome 实例，避免同源 BroadcastChannel 造成假阳性。 */
const path = require('path');
const H = require('./cdp_helper');

const SHARE = '73BAOORXNH';
const BASE = 'https://scorebug-live-relay.app.workbuddy.host';
const rnd = function (n) {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < n; i++) out += s[Math.floor(Math.random() * s.length)];
  return out;
};
const ROOM = 'ON' + rnd(5);
const OTHER = 'OT' + rnd(5);
const KEY = rnd(12);
const TAG = 'V27LIVE';
let failed = 0;
const procs = [];

function check(name, cond, extra) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' ' + name + (extra === undefined ? '' : ' (' + extra + ')'));
  if (!cond) failed++;
}
async function js(page, expr) { return H.evalJS(page, expr); }
async function get(p) {
  const r = await fetch(BASE + p, { headers: { 'Cache-Control': 'no-cache' } });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, text: text, json: json };
}
async function open(port, name, url, isMobile) {
  const chrome = H.launch(port, name, 'about:blank');
  procs.push(chrome);
  const ver = await H.waitFor('http://127.0.0.1:' + port + '/json/version', 40, true);
  const browser = await H.connect(ver.webSocketDebuggerUrl);
  const targets = await H.waitFor('http://127.0.0.1:' + port + '/json/list', 40, true);
  const t = targets.find(function (x) { return x.type === 'page'; });
  const page = await H.connect(t.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Log.enable');
  if (isMobile) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  page.events.length = 0;
  await page.send('Page.navigate', { url: url });
  await H.sleep(3200);
  return { page: page, browser: browser };
}

async function main() {
  console.log('线上域名: ' + BASE);
  console.log('测试房间: ' + ROOM + ' / 隔离房间: ' + OTHER);

  /* 1. HTTP 层：页面、接口、sharecode 放行 */
  console.log('\n[1] 线上页面与接口');
  const home = await get('/?sharecode=' + SHARE);
  check('控制器首页 200', home.status === 200, home.status);
  check('首页含作者信息', home.text.indexOf('狗王IB') >= 0);
  check('首页含手机控制入口', home.text.indexOf('mobile-control.html') >= 0);
  check('首页含云服务代码', home.text.indexOf('createWorkBuddyCloud') >= 0);
  check('首页零外链脚本', home.text.indexOf('<script src=') < 0);

  const mobilePage = await get('/mobile-control.html?sharecode=' + SHARE);
  check('/mobile-control.html 200', mobilePage.status === 200, mobilePage.status);
  check('移动端页零外链脚本 / 样式',
    mobilePage.text.indexOf('<script src=') < 0 && mobilePage.text.indexOf('<link href=') < 0);
  check('移动端页含作者信息', mobilePage.text.indexOf('狗王IB') >= 0);
  const shortUrl = await get('/m.html?sharecode=' + SHARE);
  check('/m.html 短地址与移动页一致', shortUrl.status === 200 && shortUrl.text === mobilePage.text);

  const overlay = await get('/live-overlay.html?sharecode=' + SHARE + '&room=' + ROOM);
  check('叠加层 200', overlay.status === 200, overlay.status);
  check('叠加层不含作者与移动端入口',
    overlay.text.indexOf('狗王IB') < 0 && overlay.text.indexOf('mobile-control.html') < 0);

  const health = await get('/api/health?sharecode=' + SHARE);
  check('/api/health 正常且含云服务标识',
    !!(health.json && health.json.ok === true && health.json.cloud === 'workbuddy-cloud-service'),
    JSON.stringify(health.json || {}).slice(0, 100));
  const noShare = await get('/mobile-control.html');
  check('不带 sharecode 被拦截 403', noShare.status === 403, noShare.status);
  const roomsApi0 = await get('/api/rooms?sharecode=' + SHARE);
  check('/api/rooms 返回列表结构', !!(roomsApi0.json && roomsApi0.json.ok === true && Array.isArray(roomsApi0.json.rooms)));
  const stateApi0 = await get('/api/state?sharecode=' + SHARE + '&room=' + ROOM);
  check('/api/state 空房间返回 state:null', !!(stateApi0.json && stateApi0.json.ok === true && stateApi0.json.state === null));

  /* 2. 三个独立浏览器：手机控制器 + 同房间 OBS + 另一房间 OBS */
  console.log('\n[2] 跨设备实时控制');
  const mobile = await open(9381, 'chromeV27OnlineM',
    BASE + '/mobile-control.html?sharecode=' + SHARE + '&room=' + ROOM + '&key=' + KEY, true);
  const obs = await open(9382, 'chromeV27OnlineA',
    BASE + '/live-overlay.html?sharecode=' + SHARE + '&room=' + ROOM + '&panel=1&clock=0', false);
  const other = await open(9383, 'chromeV27OnlineB',
    BASE + '/live-overlay.html?sharecode=' + SHARE + '&room=' + OTHER + '&panel=1&clock=0', false);
  await H.sleep(2200);

  const m0 = await js(mobile.page, `(function(){
    var bs=[].slice.call(document.querySelectorAll('button'));
    return { tag:document.getElementById('roleTag').textContent,
      link:document.getElementById('linkInfo').textContent,
      room:document.getElementById('roomInput').value,
      scriptSrc:document.querySelectorAll('script[src]').length,
      small:bs.filter(function(b){var r=b.getBoundingClientRect();return r.height<44||r.width<44;}).length,
      buttons:bs.length, author:document.body.textContent.indexOf('狗王IB')>=0 };
  })()`);
  check('手机页自动加入指定房间', m0.room === ROOM, m0.room);
  check('手机页为可控制角色', m0.tag === '可控制', m0.tag);
  check('手机页零外链脚本 / 作者信息 / 控件达标',
    m0.scriptSrc === 0 && m0.author && m0.small === 0, m0.buttons + ' 个按钮');
  /* 控制器在三个页面都连上后显式同步一次，避免「首次状态早于观看端连接」的时序差 */
  await js(mobile.page, `document.querySelector('[data-act="syncNow"]').click()`);
  await H.sleep(1400);
  const o0 = await js(obs.page, `document.getElementById('srcInfo').textContent`);
  check('同房间叠加层已连线上中继', o0.indexOf('线上房间 ' + ROOM) >= 0, o0.slice(0, 90));

  /* 真实触摸：主队 +1 */
  const pos = await js(mobile.page, `(function(){
    var b=document.querySelector('[data-act="score"][data-field="homeScore"][data-delta="1"]');
    b.scrollIntoView({block:'center'});
    var r=b.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  await mobile.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y, id: 1 }] });
  await mobile.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await H.sleep(400);
  const score = await js(mobile.page, `document.getElementById('homeScore').textContent`);
  check('真实触摸使主队 +1', String(score) === '5', score);

  /* 改客队队名，推送到叠加层 */
  await js(mobile.page, `(function(){
    var el=document.getElementById('awayName');
    el.value='${TAG}';
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await H.sleep(1800);
  const a1 = await js(obs.page, `({src:document.getElementById('srcInfo').textContent,txt:document.getElementById('overlay').textContent})`);
  const b1 = await js(other.page, `({src:document.getElementById('srcInfo').textContent,room:document.getElementById('roomInfo').textContent,txt:document.getElementById('overlay').textContent})`);
  check('同房间叠加层收到新队名', a1.txt.indexOf(TAG) >= 0, a1.src.slice(0, 70));
  check('叠加层数据源标注线上房间', a1.src.indexOf('线上房间 ' + ROOM) >= 0, a1.src.slice(0, 70));
  check('另一房间叠加层未串台',
    b1.txt.indexOf(TAG) < 0 && b1.src.indexOf(ROOM) < 0 && b1.room.indexOf(OTHER) >= 0,
    b1.room.slice(0, 60) + ' / ' + b1.src.slice(0, 40));

  /* 3. 接口读回与密钥保护 */
  console.log('\n[3] 接口读回与隐私');
  const roomsApi = await get('/api/rooms?sharecode=' + SHARE);
  const list = (roomsApi.json && roomsApi.json.rooms) || [];
  check('/api/rooms 列出本次房间', list.some(function (r) { return r.id === ROOM; }),
    JSON.stringify(list).slice(0, 140));
  check('/api/rooms 不泄露控制密钥', roomsApi.text.indexOf(KEY) < 0);
  const stateApi = await get('/api/state?sharecode=' + SHARE + '&room=' + ROOM);
  check('/api/state 可读回最后一次状态',
    !!(stateApi.json && stateApi.json.state && JSON.stringify(stateApi.json.state).indexOf(TAG) >= 0),
    String(stateApi.json && stateApi.json.seq));
  const stateOther = await get('/api/state?sharecode=' + SHARE + '&room=' + OTHER);
  check('另一房间 /api/state 为空（隔离）',
    !!(stateOther.json && !stateOther.json.state), String(stateOther.json && stateOther.json.seq));

  /* 4. 无未捕获异常 */
  console.log('\n[4] 运行时');
  const errM = mobile.page.events.filter(function (e) { return e.method === 'Runtime.exceptionThrown'; });
  const errA = obs.page.events.filter(function (e) { return e.method === 'Runtime.exceptionThrown'; });
  const errB = other.page.events.filter(function (e) { return e.method === 'Runtime.exceptionThrown'; });
  check('手机页 / 两个叠加层均无未捕获异常', errM.length === 0 && errA.length === 0 && errB.length === 0,
    errM.length + '/' + errA.length + '/' + errB.length);

  console.log('\n结果: ' + (failed === 0 ? '全部通过' : failed + ' 项失败'));
  if (failed) process.exitCode = 1;
}

main().catch(function (e) { console.error(e); process.exitCode = 1; }).finally(function () {
  procs.forEach(function (p) { try { p.kill(); } catch (e) {} });
});
