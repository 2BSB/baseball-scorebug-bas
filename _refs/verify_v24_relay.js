/* v24 线上中继验证：多房间 / 多客户端并发，重点验证「控制不会串台」。
 * 覆盖：WebSocket 房间隔离、伪造 room 字段、观众越权、控制密钥、HTTP 轮询兜底、内存不落盘。
 * 可用环境变量 SITE 指向已部署的线上地址，对公网服务复测。 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('./cdp_helper');

const root = path.resolve(__dirname, '..');
const LOCAL_PORT = 9242;
const SITE_RAW = process.env.SITE || ('http://127.0.0.1:' + LOCAL_PORT);
const SITE_URL = new URL(SITE_RAW);
const BASE = SITE_URL.origin;
const TICKET = SITE_URL.searchParams.get('sharecode') || '';
const WS_BASE = BASE.replace(/^http/, 'ws');
function randRoom() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
const ROOM_A = randRoom(), ROOM_B = randRoom();
const KEY_A = 'KEYALPHA1111', KEY_B = 'KEYBETA2222';
function ticket(url) {
  return TICKET ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + encodeURIComponent(TICKET) : url;
}

function listFiles(dir, acc) {
  acc = acc || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, acc); else acc.push(p);
  });
  return acc;
}
async function startServer() {
  const srvDir = path.join(root, 'online-app');
  const p = spawn(process.execPath, ['server.js'], {
    cwd: srvDir, env: Object.assign({}, process.env, { PORT: String(LOCAL_PORT) }), stdio: 'ignore'
  });
  await H.waitFor('http://127.0.0.1:' + LOCAL_PORT + '/api/health', 40, true);
  return p;
}
function wsClient(room, role, key, peer) {
  return new Promise(function (resolve, reject) {
    const url = ticket(WS_BASE + '/ws?room=' + room + '&role=' + role + '&key=' + encodeURIComponent(key) + '&peer=' + peer);
    const ws = new WebSocket(url);
    const c = { ws: ws, msgs: [], peer: peer, room: room, opened: false };
    let settled = false;
    ws.onmessage = function (ev) { try { c.msgs.push(JSON.parse(ev.data)); } catch (e) {} };
    ws.onopen = function () { c.opened = true; settled = true; resolve(c); };
    ws.onerror = function () { if (!c.opened && !settled) { settled = true; reject(new Error('ws rejected: ' + peer)); } };
    ws.onclose = function () { if (!c.opened && !settled) { settled = true; reject(new Error('ws closed: ' + peer)); } };
    setTimeout(function () { if (!settled) { settled = true; reject(new Error('ws timeout: ' + peer)); } }, 5000);
  });
}
function send(c, obj) { c.ws.send(JSON.stringify(obj)); }
function hasState(c, name) {
  return c.msgs.some(function (m) {
    return m.type === 'state' && JSON.stringify(m.payload || {}).indexOf(name) >= 0;
  });
}
function hasSync(c, t) {
  return c.msgs.some(function (m) { return m.type === 'sync' && m.t === t; });
}
async function jsonPost(url, body) {
  const r = await fetch(ticket(url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { code: r.status, data: await r.json() };
}

async function main() {
  let server = null;
  const clients = [];
  const results = {};
  try {
    const before = process.env.SITE ? null : listFiles(path.join(root, 'online-app')).sort();
    if (!process.env.SITE) server = await startServer();
    else await H.waitFor(ticket(BASE + '/api/health'), 40, true);

    const cA = await wsClient(ROOM_A, 'controller', KEY_A, 'ctrlA'); clients.push(cA);
    const vA1 = await wsClient(ROOM_A, 'viewer', '', 'viewA1'); clients.push(vA1);
    const vA2 = await wsClient(ROOM_A, 'viewer', '', 'viewA2'); clients.push(vA2);
    const cB = await wsClient(ROOM_B, 'controller', KEY_B, 'ctrlB'); clients.push(cB);
    const vB1 = await wsClient(ROOM_B, 'viewer', '', 'viewB1'); clients.push(vB1);
    await H.sleep(250);

    /* 1. A 房间控制：同房间都收到，B 房间收不到 */
    send(cA, { type: 'state', payload: { state: { awayName: 'ALPHA_TEAM' } }, from: 'ctrlA' });
    await H.sleep(350);
    results.a_room_received = hasState(vA1, 'ALPHA_TEAM') && hasState(vA2, 'ALPHA_TEAM') &&
      vA1.msgs.every(function (m) { return !m.room || m.room === ROOM_A; });
    results.a_no_leak_to_b = !hasState(vB1, 'ALPHA_TEAM') && !hasState(cB, 'ALPHA_TEAM');

    /* 2. B 房间控制：反向同样隔离 */
    send(cB, { type: 'state', payload: { state: { awayName: 'BETA_TEAM' } }, from: 'ctrlB' });
    await H.sleep(350);
    results.b_room_received = hasState(vB1, 'BETA_TEAM');
    results.b_no_leak_to_a = !hasState(vA1, 'BETA_TEAM') && !hasState(vA2, 'BETA_TEAM') && !hasState(cA, 'BETA_TEAM');

    /* 3. 控制器伪造 room 字段，服务端仍按连接绑定房间 */
    send(cA, { type: 'state', room: ROOM_B, payload: { state: { awayName: 'SPOOF_TEAM' } }, from: 'ctrlA' });
    await H.sleep(350);
    results.spoof_rejected = !hasState(vB1, 'SPOOF_TEAM') && !hasState(cB, 'SPOOF_TEAM');
    results.spoof_stays_in_a = vA1.msgs.some(function (m) {
      return m.type === 'state' && m.room === ROOM_A && JSON.stringify(m.payload || {}).indexOf('SPOOF_TEAM') >= 0;
    });

    /* 4. 时间同步也按房间隔离 */
    send(cA, { type: 'sync', t: 123, from: 'ctrlA' });
    send(cB, { type: 'sync', t: 456, from: 'ctrlB' });
    await H.sleep(350);
    results.sync_isolated = hasSync(vA1, 123) && !hasSync(vA1, 456) && hasSync(vB1, 456) && !hasSync(vB1, 123);

    /* 5. 观众不能推送状态 */
    send(vA1, { type: 'state', payload: { state: { awayName: 'VIEWER_HACK' } }, from: 'viewA1' });
    await H.sleep(300);
    results.viewer_readonly = !hasState(vA2, 'VIEWER_HACK') && !hasState(vB1, 'VIEWER_HACK');

    /* 6. 错误控制密钥无法成为同房间控制器 */
    let rogueRejected = false;
    try { const rogue = await wsClient(ROOM_A, 'controller', 'WRONG_KEY', 'rogue'); clients.push(rogue); }
    catch (e) { rogueRejected = true; }
    await H.sleep(150);
    results.key_protected = rogueRejected && !hasState(vA1, 'ROGUE_TEAM');

    /* 7. HTTP 轮询兜底：推送 / 拉取 / 长轮询，且房间隔离 */
    const pushA = await jsonPost(BASE + '/api/push', {
      room: ROOM_A, role: 'controller', key: KEY_A, peer: 'pollCtrlA',
      type: 'state', payload: { state: { awayName: 'POLL_ALPHA' } }, from: 'pollCtrlA'
    });
    const pollA = await (await fetch(ticket(BASE + '/api/poll?room=' + ROOM_A + '&role=viewer&peer=pollViewA&since=0'))).json();
    const pollB = await (await fetch(ticket(BASE + '/api/poll?room=' + ROOM_B + '&role=viewer&peer=pollViewB&since=0'))).json();
    const maxSeq = (pollA.messages || []).reduce(function (a, m) { return Math.max(a, m.seq || 0); }, 0);
    const longPending = fetch(ticket(BASE + '/api/poll?room=' + ROOM_A + '&role=viewer&peer=pollLong&since=' + maxSeq)).then(function (r) { return r.json(); });
    await H.sleep(150);
    const pushLong = await jsonPost(BASE + '/api/push', {
      room: ROOM_A, role: 'controller', key: KEY_A, peer: 'pollCtrlA',
      type: 'state', payload: { state: { awayName: 'LONGPOLL_OK' } }, from: 'pollCtrlA'
    });
    const longPoll = await Promise.race([longPending, H.sleep(6000).then(function () { return { messages: [] }; })]);
    const wrongKey = await jsonPost(BASE + '/api/push', {
      room: ROOM_A, role: 'controller', key: 'WRONG', peer: 'bad',
      type: 'state', payload: { state: { awayName: 'BAD_KEY' } }, from: 'bad'
    });
    const viewerPush = await jsonPost(BASE + '/api/push', {
      room: ROOM_A, role: 'viewer', key: '', peer: 'v',
      type: 'state', payload: { state: { awayName: 'VIEWER_HTTP' } }, from: 'v'
    });
    results.http_push_ok = pushA.code === 200 && pushA.data.ok === true && pushLong.data.ok === true;
    results.http_poll_isolated = (pollA.messages || []).some(function (m) { return JSON.stringify(m).indexOf('POLL_ALPHA') >= 0; }) &&
      !(pollB.messages || []).some(function (m) { return JSON.stringify(m).indexOf('POLL_ALPHA') >= 0; });
    results.http_longpoll_ok = (longPoll.messages || []).some(function (m) { return JSON.stringify(m).indexOf('LONGPOLL_OK') >= 0; });
    results.http_key_and_role = wrongKey.code === 403 && viewerPush.code === 403;

    /* 8. 健康检查与「不落盘」 */
    const health = await (await fetch(ticket(BASE + '/api/health'))).json();
    results.health = health.ok === true && health.persistence === 'memory-only' && health.rooms >= 2;
    if (before) {
      const after = listFiles(path.join(root, 'online-app')).sort();
      results.no_disk_writes = JSON.stringify(before) === JSON.stringify(after);
    } else results.no_disk_writes = true;  // 线上服务无法列目录，以 health 声明为准
    results.health_detail = health;

    console.log(JSON.stringify(results, null, 2));
    const keys = ['a_room_received', 'a_no_leak_to_b', 'b_room_received', 'b_no_leak_to_a',
      'spoof_rejected', 'spoof_stays_in_a', 'sync_isolated', 'viewer_readonly', 'key_protected',
      'http_push_ok', 'http_poll_isolated', 'http_longpoll_ok', 'http_key_and_role',
      'health', 'no_disk_writes'];
    const ok = keys.every(function (k) { return results[k] === true; });
    console.log('RELAY_V24_OK=' + ok);
    if (!ok) {
      console.log('failed=' + keys.filter(function (k) { return results[k] !== true; }).join(','));
      process.exitCode = 1;
    }
  } finally {
    clients.forEach(function (c) { try { c.ws.close(); } catch (e) {} });
    if (server) server.kill();
  }
}
main().catch(function (e) { console.error('RELAY_V24_FAIL', e.message); process.exitCode = 1; });
