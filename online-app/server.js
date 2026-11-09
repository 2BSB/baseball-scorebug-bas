'use strict';
/* 棒球计分直播叠加层 · 线上房间中继
 * 单端口 HTTP 服务：静态页面 + WebSocket 中转 + HTTP 长轮询兜底。
 * 隔离策略：连接时绑定房间号，服务端只向同一房间转发，忽略客户端自带的 room 字段；
 *           控制器带随机控制密钥，观众只读，不同房间之间绝不互通。
 * 隐私策略：房间与消息只在内存 Map 中，空闲自动清理；不写文件、不写数据库、不记录消息内容。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_TEXT = 256 * 1024;
const MAX_FRAME = 1024 * 1024;
const MAX_ROOMS = 300;
const MAX_CLIENTS = 24;
const ROOM_IDLE_MS = 30 * 60 * 1000;

const rooms = new Map();
let clientSeq = 0;

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/live-overlay.html': ['live-overlay.html', 'text/html; charset=utf-8'],
  '/reference-scoreboard.png': ['reference-scoreboard.png', 'image/png']
};

function normRoom(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}
function now() { return Date.now(); }
function getRoom(id, create) {
  let r = rooms.get(id);
  if (!r) {
    if (!create || rooms.size >= MAX_ROOMS) return null;
    r = { id: id, key: null, clients: new Set(), pollPeers: new Map(), waiters: [],
          history: [], seq: 0, createdAt: now(), last: now() };
    rooms.set(id, r);
  }
  return r;
}
function presence(r) {
  const t = now();
  let controllers = 0, viewers = 0;
  r.clients.forEach(function (cl) { if (cl.dead) return; cl.controller ? controllers++ : viewers++; });
  r.pollPeers.forEach(function (p, peer) {
    if (t - p.last > 45000) { r.pollPeers.delete(peer); return; }
    p.role === 'controller' ? controllers++ : viewers++;
  });
  return { type: 'presence', controllers: controllers, viewers: viewers };
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}
function replyJson(res, code, obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length });
  res.end(data);
}
function readBody(req, cb) {
  let size = 0;
  const parts = [];
  req.on('data', function (c) {
    size += c.length;
    if (size > MAX_TEXT + 1024) { req.destroy(); return; }
    parts.push(c);
  });
  req.on('end', function () { cb(Buffer.concat(parts).toString('utf8')); });
  req.on('error', function () {});
}

/* ---------- WebSocket 帧（RFC 6455，服务端发不掩码，客户端帧必须掩码） ---------- */
function buildFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  let head;
  if (data.length < 126) { head = Buffer.alloc(2); head[1] = data.length; }
  else if (data.length < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(data.length, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, data]);
}
function parseFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f, off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(MAX_FRAME)) return -1;
    len = Number(big); off = 10;
  }
  if (len > MAX_FRAME) return -1;
  let mask = null;
  if (masked) { if (buf.length < off + 4) return null; mask = buf.subarray(off, off + 4); off += 4; }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return { fin: fin, opcode: opcode, payload: payload, consumed: off + len };
}
function sendFrame(socket, obj) {
  try { socket.write(buildFrame(0x1, JSON.stringify(obj))); } catch (e) {}
}

/* ---------- 房间广播（唯一出口，强制打上服务端认定的房间号） ---------- */
function broadcast(r, obj, exclude, from) {
  r.last = now();
  const msg = Object.assign({}, obj, { room: r.id, seq: ++r.seq, from: from || '' });
  r.history.push(msg);
  if (r.history.length > 40) r.history.shift();
  r.clients.forEach(function (cl) {
    if (cl !== exclude && !cl.dead) sendFrame(cl.socket, msg);
  });
  const waiters = r.waiters;
  r.waiters = [];
  waiters.forEach(function (w) {
    clearTimeout(w.timer);
    replyJson(w.res, 200, { messages: [msg], presence: presence(r) });
  });
}
function joinRoom(r, role, key, peer) {
  const t = now();
  r.pollPeers.set(peer, { role: role, last: t });
  r.last = t;
}
function pushMessage(r, obj, from) {
  r.last = now();
  const msg = Object.assign({}, obj, { room: r.id, seq: ++r.seq, from: from || '' });
  if (JSON.stringify(msg).length > MAX_TEXT) return false;
  r.history.push(msg);
  if (r.history.length > 40) r.history.shift();
  r.clients.forEach(function (cl) { if (!cl.dead) sendFrame(cl.socket, msg); });
  const waiters = r.waiters;
  r.waiters = [];
  waiters.forEach(function (w) {
    clearTimeout(w.timer);
    replyJson(w.res, 200, { messages: [msg], presence: presence(r) });
  });
  return true;
}

/* ---------- HTTP ---------- */
function handleApi(u, req, res) {
  const p = u.pathname;
  if (p === '/api/health') {
    let sockets = 0, pollers = 0;
    rooms.forEach(function (r) { sockets += r.clients.size; pollers += r.pollPeers.size; });
    return replyJson(res, 200, {
      ok: true, rooms: rooms.size, wsClients: sockets, pollPeers: pollers,
      transports: ['websocket', 'http-poll'], persistence: 'memory-only',
      cloud: 'workbuddy-cloud-service',
      uptimeSec: Math.round((now() - startedAt) / 1000)
    });
  }
  if (p === '/api/poll') {
    const id = normRoom(u.searchParams.get('room'));
    if (id.length < 4) return replyJson(res, 400, { error: '房间号无效' });
    const r = getRoom(id, true);
    if (!r) return replyJson(res, 503, { error: '房间数已达上限' });
    joinRoom(r, u.searchParams.get('role') === 'controller' ? 'controller' : 'viewer',
             u.searchParams.get('peer') || 'anon');
    const since = Number(u.searchParams.get('since') || 0);
    const msgs = r.history.filter(function (m) { return m.seq > since; });
    if (msgs.length) return replyJson(res, 200, { messages: msgs, presence: presence(r) });
    const w = { res: res, timer: null };
    w.timer = setTimeout(function () {
      r.waiters = r.waiters.filter(function (x) { return x !== w; });
      replyJson(res, 200, { messages: [], presence: presence(r) });
    }, 20000);
    r.waiters.push(w);
    res.on('close', function () {
      clearTimeout(w.timer);
      r.waiters = r.waiters.filter(function (x) { return x !== w; });
    });
    return;
  }
  if (p === '/api/push' && req.method === 'POST') {
    return readBody(req, function (body) {
      let m;
      try { m = JSON.parse(body); } catch (e) { return replyJson(res, 400, { error: 'bad json' }); }
      const id = normRoom(m.room);
      const r = rooms.get(id);
      if (!r) return replyJson(res, 404, { error: '房间不存在' });
      if (m.role !== 'controller') return replyJson(res, 403, { error: '只有控制器能推送' });
      if (r.key && m.key !== r.key) return replyJson(res, 403, { error: '控制密钥不匹配' });
      if (m.type !== 'state' && m.type !== 'sync') return replyJson(res, 400, { error: '消息类型无效' });
      const obj = m.type === 'state' ? { type: 'state', payload: m.payload } : { type: 'sync', t: Number(m.t) || 0 };
      pushMessage(r, obj, m.from || '');
      return replyJson(res, 200, { ok: true, seq: r.seq });
    });
  }
  return replyJson(res, 404, { error: 'not found' });
}
const startedAt = now();
const server = http.createServer(function (req, res) {
  let u;
  try { u = new URL(req.url, 'http://relay.local'); }
  catch (e) { return replyJson(res, 400, { error: 'bad url' }); }
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (u.pathname.indexOf('/api/') === 0) return handleApi(u, req, res);
  const ent = STATIC[u.pathname];
  if (!ent) return replyJson(res, 404, { error: 'not found' });
  fs.readFile(path.join(PUBLIC, ent[0]), function (err, data) {
    if (err) return replyJson(res, 404, { error: 'missing asset' });
    cors(res);
    res.writeHead(200, {
      'Content-Type': ent[1], 'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
});

/* ---------- WebSocket 升级 ---------- */
server.on('upgrade', function (req, socket, head) {
  let u;
  try { u = new URL(req.url, 'http://relay.local'); }
  catch (e) { socket.destroy(); return; }
  const id = normRoom(u.searchParams.get('room'));
  const role = u.searchParams.get('role') === 'controller' ? 'controller' : 'viewer';
  const key = String(u.searchParams.get('key') || '');
  const peer = String(u.searchParams.get('peer') || 'anon');
  function reject(code, text) {
    try { socket.write('HTTP/1.1 ' + code + ' ' + text + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); } catch (e) {}
    socket.destroy();
  }
  if (u.pathname !== '/ws') return reject(404, 'Not Found');
  if (id.length < 4) return reject(400, 'Bad Room');
  const r = getRoom(id, true);
  if (!r) return reject(503, 'Room Limit');
  if (role === 'controller') {
    if (r.key && r.key !== key) return reject(403, 'Bad Key');
    if (!r.key && key) r.key = key;
  }
  if (r.clients.size >= MAX_CLIENTS) return reject(503, 'Room Full');
  const accept = crypto.createHash('sha1')
    .update(String(req.headers['sec-websocket-key'] || '') + GUID).digest('base64');
  try {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  } catch (e) { socket.destroy(); return; }

  const cl = {
    id: ++clientSeq, socket: socket, room: r, controller: role === 'controller', key: key,
    peer: peer, dead: false, buf: Buffer.alloc(0), parts: [], last: now(),
    count: 0, window: now()
  };
  r.clients.add(cl);
  sendFrame(socket, { type: 'joined', room: r.id, role: role, seq: r.seq, from: '' });
  broadcast(r, presence(r), null, '');

  socket.on('data', function (chunk) {
    cl.buf = Buffer.concat([cl.buf, chunk]);
    if (cl.buf.length > MAX_FRAME * 2) { socket.destroy(); return; }
    let f;
    while ((f = parseFrame(cl.buf)) !== null) {
      if (f === -1) { socket.destroy(); return; }
      cl.buf = cl.buf.subarray(f.consumed);
      cl.last = now();
      if (f.opcode === 0x8) { socket.end(); return; }
      if (f.opcode === 0x9) { try { socket.write(buildFrame(0xA, f.payload)); } catch (e) {} continue; }
      if (f.opcode === 0xA) continue;
      if (f.opcode === 0x1 || f.opcode === 0x2 || f.opcode === 0x0) {
        cl.parts.push(f.payload);
        if (f.fin) {
          const text = Buffer.concat(cl.parts).toString('utf8');
          cl.parts = [];
          handleClientText(cl, text);
        }
      } else { cl.parts = []; }
    }
  });
  function bye() {
    if (cl.dead) return;
    cl.dead = true;
    r.clients.delete(cl);
    if (r.clients.size || r.pollPeers.size) broadcast(r, presence(r), null, '');
  }
  socket.on('close', bye);
  socket.on('error', bye);
  if (head && head.length) socket.emit('data', head);
});

function handleClientText(cl, text) {
  if (text.length > MAX_TEXT) return;
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (m.type === 'ping') { cl.last = now(); return; }
  if (!cl.controller) return;                       // 观众只读
  if (cl.room.key && cl.key !== cl.room.key) return;
  if (m.type !== 'state' && m.type !== 'sync') return;
  const t = now();
  if (t - cl.window > 1000) { cl.window = t; cl.count = 0; }
  if (++cl.count > 30) return;
  cl.last = t;
  const obj = m.type === 'state' ? { type: 'state', payload: m.payload } : { type: 'sync', t: Number(m.t) || 0 };
  if (JSON.stringify(obj).length > MAX_TEXT) return;
  /* 忽略 m.room：房间号按连接绑定，无法靠消息体串到别的房间 */
  broadcast(cl.room, obj, cl, m.from || '');
}

/* 心跳与空闲房间回收；不写任何日志 */
setInterval(function () {
  const t = now();
  rooms.forEach(function (r) {
    r.clients.forEach(function (cl) {
      if (cl.dead) return;
      if (t - cl.last > 90000) { cl.dead = true; try { cl.socket.destroy(); } catch (e) {} r.clients.delete(cl); }
      else { try { cl.socket.write(buildFrame(0x9, Buffer.alloc(0))); } catch (e) {} }
    });
    r.pollPeers.forEach(function (p, peer) { if (t - p.last > 60000) r.pollPeers.delete(peer); });
    if (!r.clients.size && !r.pollPeers.size && t - r.last > ROOM_IDLE_MS) rooms.delete(r.id);
  });
}, 30000).unref();

server.listen(PORT, '0.0.0.0', function () {
  console.log('scorebug relay listening on 0.0.0.0:' + PORT + ' (memory-only rooms)');
});
