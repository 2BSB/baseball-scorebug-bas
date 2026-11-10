/* v27 验证：移动端控制页（手机视口 + 真实触摸事件）与线上叠加层端到端联动。
 * 覆盖：房间列表可选加入、控制密钥 / 只读模式、触摸点击改比分、跨房间隔离、
 * /api/state 接管恢复、零外链脚本、控件尺寸与作者信息。全程只连本机 127.0.0.1。 */
const { spawn } = require('child_process');
const path = require('path');
const H = require('./cdp_helper');

const root = path.resolve(__dirname, '..');
const PORT = 3200;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOM = 'MOBILE1';
const KEY = 'TESTKEY123456';
const OTHER = 'ISOLATE2';
let failed = 0, srv = null, mobile = null, obs = null;

function check(name, cond, extra) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' ' + name + (extra === undefined ? '' : ' (' + extra + ')'));
  if (!cond) failed++;
}
async function js(page, expr) { return H.evalJS(page, expr); }
async function open(port, name, url, isMobile) {
  const chrome = H.launch(port, name, 'about:blank');
  const ver = await H.waitFor('http://127.0.0.1:' + port + '/json/version', 40, true);
  const browser = await H.connect(ver.webSocketDebuggerUrl);
  const targets = await H.waitFor('http://127.0.0.1:' + port + '/json/list', 40, true);
  const t = targets.find(function (x) { return x.type === 'page'; });
  const page = await H.connect(t.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Log.enable');
  if (isMobile) {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  page.events.length = 0;
  await page.send('Page.navigate', { url: url });
  await H.sleep(2000);
  return { chrome: chrome, browser: browser, page: page };
}
async function api(p) {
  const r = await fetch(BASE + p, { cache: 'no-store' });
  return r.json();
}

async function main() {
  srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(root, 'online-app'),
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore'
  });
  const health = await H.waitFor(BASE + '/api/health', 40, true);
  console.log('[服务] /api/health ok=' + health.ok + ' port=' + PORT);

  mobile = await open(9281, 'chromeV27mobile',
    BASE + '/mobile-control.html?room=' + ROOM + '&key=' + KEY, true);
  obs = await open(9282, 'chromeV27overlay',
    BASE + '/live-overlay.html?room=' + ROOM + '&panel=1', false);

  /* 1. 手机页面基础与触摸友好度 */
  const base = await js(mobile.page, `(function(){
    var vp=document.querySelector('meta[name=viewport]').content;
    var bs=[].slice.call(document.querySelectorAll('button'));
    var small=bs.filter(function(b){var r=b.getBoundingClientRect();return r.height<44||r.width<44;})
      .map(function(b){return (b.textContent||'').trim().slice(0,12)+':'+Math.round(b.getBoundingClientRect().height);});
    return { title:document.title, viewport:vp, scriptSrc:document.querySelectorAll('script[src]').length,
      linkHref:document.querySelectorAll('link[href]').length, author:document.body.textContent.indexOf('狗王IB')>=0,
      small:small, buttons:bs.length, inputFont:getComputedStyle(document.getElementById('roomInput')).fontSize,
      tag:document.getElementById('roleTag').textContent, link:document.getElementById('linkInfo').textContent,
      roomInput:document.getElementById('roomInput').value, chips:document.getElementById('roomChips').textContent };
  })()`);
  console.log('\n[1] 手机页面基础');
  check('页面标题', /手机控制/.test(base.title), base.title);
  check('viewport 禁止缩放 + 安全区', /user-scalable=no/.test(base.viewport) && /viewport-fit=cover/.test(base.viewport));
  check('零外链脚本 / 样式', base.scriptSrc === 0 && base.linkHref === 0, base.scriptSrc + '/' + base.linkHref);
  check('作者信息存在', base.author);
  check('输入框 16px 防 iOS 自动缩放', base.inputFont === '16px', base.inputFont);
  check('全部按钮 ≥44px', base.small.length === 0, base.buttons + ' 个按钮，过小：' + base.small.join(','));
  check('URL 带房间号时自动加入', base.tag === '可控制' && base.link.indexOf(ROOM) >= 0, base.tag + ' / ' + base.link.slice(0, 60));

  /* 2. 房间列表与「可选加入的房间号」 */
  const rooms = await api('/api/rooms');
  console.log('\n[2] 房间列表 / 可选加入');
  check('/api/rooms 返回房间列表', rooms.ok === true && rooms.rooms.some(function (r) { return r.id === ROOM; }),
    JSON.stringify(rooms.rooms || []).slice(0, 160));
  const mine = (rooms.rooms || []).find(function (r) { return r.id === ROOM; });
  check('已设密钥的房间标记为 locked', !!mine && mine.locked === true);
  check('房间列表不泄露控制密钥', !/TESTKEY123456/.test(JSON.stringify(rooms)));
  check('页面渲染出房间 chip', base.chips.indexOf(ROOM) >= 0, base.chips.slice(0, 80));
  await js(mobile.page, `document.querySelector('.chip[data-room="${ROOM}"]').click()`);
  await H.sleep(700);
  const afterChip = await js(mobile.page, `({room:document.getElementById('roomInput').value,tag:document.getElementById('roleTag').textContent})`);
  check('点房间 chip 直接加入', afterChip.room === ROOM && afterChip.tag === '可控制', JSON.stringify(afterChip));

  /* 3. 手机 → 叠加层：真实触摸事件改比分 + 改队名 */
  console.log('\n[3] 触摸操作 → 叠加层');
  const before = await js(obs.page, `document.getElementById('srcInfo').textContent`);
  check('叠加层已连上同一房间', before.indexOf('线上房间 ' + ROOM) >= 0 || before.indexOf('同源控制器') >= 0,
    before.slice(0, 90));
  const pos = await js(mobile.page, `(function(){
    var b=document.querySelector('[data-act="score"][data-field="homeScore"][data-delta="1"]');
    b.scrollIntoView({block:'center'});
    var r=b.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  await mobile.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y, id: 1 }] });
  await mobile.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await H.sleep(300);
  const homeScore = await js(mobile.page, `document.getElementById('homeScore').textContent`);
  check('真实触摸点击使主队 +1', String(homeScore) === '5', '比分=' + homeScore);
  await js(mobile.page, `(function(){
    var el=document.getElementById('awayName');
    el.value='MOBTEST';
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await H.sleep(1100);
  const ov = await js(obs.page, `({src:document.getElementById('srcInfo').textContent,txt:document.getElementById('overlay').textContent})`);
  check('叠加层收到队名 MOBTEST', ov.txt.indexOf('MOBTEST') >= 0, ov.src.slice(0, 80));
  check('叠加层数据源标注线上房间', ov.src.indexOf('线上房间 ' + ROOM) >= 0, ov.src.slice(0, 80));

  /* 4. 房间隔离：手机切到另一个房间后，原叠加层不再变化 */
  console.log('\n[4] 房间隔离');
  await js(mobile.page, `(function(){
    document.getElementById('roomInput').value='${OTHER}';
    document.querySelector('[data-act="join"]').click();
  })()`);
  await H.sleep(900);
  await js(mobile.page, `(function(){
    var el=document.getElementById('awayName');
    el.value='OTHERRM';
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await H.sleep(1000);
  const ov2 = await js(obs.page, `document.getElementById('overlay').textContent`);
  check('原房间仍保留 MOBTEST', ov2.indexOf('MOBTEST') >= 0);
  check('另一房间的改动没有串进来', ov2.indexOf('OTHERRM') < 0);
  const stateApi = await api('/api/state?room=' + ROOM);
  check('/api/state 可读回最后一次状态', !!(stateApi.state && JSON.stringify(stateApi.state).indexOf('MOBTEST') >= 0),
    String(stateApi.seq));

  /* 5. 只读观看：不带密钥加入时控制按钮禁用 */
  console.log('\n[5] 只读模式');
  await js(mobile.page, `(function(){
    document.getElementById('roomInput').value='${ROOM}';
    document.getElementById('keyInput').value='';
    document.querySelector('[data-act="join"]').click();
  })()`);
  await H.sleep(900);
  const ro = await js(mobile.page, `({
    tag:document.getElementById('roleTag').textContent,
    disabled:document.querySelector('#controlArea button[data-act="score"]').disabled,
    locked:document.getElementById('controlArea').classList.contains('locked-ui')
  })`);
  check('无密钥＝只读观看', ro.tag === '只读观看', ro.tag);
  check('控制按钮被禁用', ro.disabled === true && ro.locked === true);

  /* 6. 无 JS 异常 */
  const errM = mobile.page.events.filter(function (e) { return e.method === 'Runtime.exceptionThrown'; });
  const errO = obs.page.events.filter(function (e) { return e.method === 'Runtime.exceptionThrown'; });
  console.log('\n[6] 运行时');
  check('手机页无未捕获异常', errM.length === 0, errM.length);
  check('叠加层无未捕获异常', errO.length === 0, errO.length);

  console.log('\n结果: ' + (failed === 0 ? '全部通过' : failed + ' 项失败'));
  if (failed) process.exitCode = 1;
}
main().catch(function (e) { console.error(e); process.exitCode = 1; }).finally(function () {
  if (mobile) { try { mobile.page.close(); mobile.browser.close(); } catch (e) {} mobile.chrome.kill(); }
  if (obs) { try { obs.page.close(); obs.browser.close(); } catch (e) {} obs.chrome.kill(); }
  if (srv) srv.kill();
});
