/* 线上房间中继客户端：WebSocket 优先，HTTP 长轮询兜底。
 * 只有在调用 connect() 后才会发起连接；服务端会按连接绑定的房间号二次校验，
 * 客户端也会丢弃房间号不匹配的推送，双保险防止多人使用时串台。
 * RELAY-CLIENT-START / END 标记供发布检查脚本识别「唯一允许联网的代码块」。
 */
/* RELAY-CLIENT-START */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root) root.ScorebugRelay = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function splitServer(s) {
    s = String(s || '').trim().replace(/\/+$/, '');
    if (!s) {
      if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) s = location.origin;
      else return { base: '', ticket: '' };
    }
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      var u = new URL(s);
      return { base: u.origin, ticket: u.searchParams.get('sharecode') || '' };
    } catch (e) { return { base: s, ticket: '' }; }
  }
  function normServer(s) { return splitServer(s).base; }
  function pageTicket() {
    if (typeof location === 'undefined' || !location.search) return '';
    try { return new URLSearchParams(location.search).get('sharecode') || ''; } catch (e) { return ''; }
  }
  function withTicket(url, ticket) {
    if (!ticket) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + encodeURIComponent(ticket);
  }
  function normRoom(r) {
    return String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }
  function randomPeer() {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    try {
      var w = typeof window !== 'undefined' ? window : null;
      var c = w && (w.crypto || w.msCrypto);
      if (!c || !c.getRandomValues) throw new Error('no crypto');
      var b = new Uint8Array(10);
      c.getRandomValues(b);
      for (var i = 0; i < 10; i++) s += a[b[i] % a.length];
    } catch (e) { for (var j = 0; j < 10; j++) s += a[Math.floor(Math.random() * a.length)]; }
    return s;
  }
  function wsUrl(server, cfg, ticket) {
    var url = server.replace(/^http/i, 'ws') + '/ws?room=' + encodeURIComponent(cfg.room) +
      '&role=' + cfg.role + '&peer=' + encodeURIComponent(cfg.peer) +
      (cfg.key ? '&key=' + encodeURIComponent(cfg.key) : '');
    return withTicket(url, ticket);
  }

  function create(cfg) {
    cfg = cfg || {};
    var parsed = splitServer(cfg.server);
    var server = parsed.base;
    var ticket = cfg.ticket || parsed.ticket || pageTicket();
    var room = normRoom(cfg.room);
    var role = cfg.role === 'controller' ? 'controller' : 'viewer';
    var key = cfg.key || '';
    var peer = cfg.peer || randomPeer();
    var stopped = false, ws = null, pollAbort = null, retryTimer = null;
    var since = 0, queue = [], transport = 'offline', connected = false, lastError = '';

    function emit() {
      if (cfg.onStatus) cfg.onStatus({
        connected: connected, transport: transport, room: room, server: server, detail: lastError
      });
    }
    function deliver(m) {
      if (!m || typeof m !== 'object') return;
      if (m.room && normRoom(m.room) !== room) return;   // 房间不符直接丢弃
      if (m.from && m.from === peer) return;             // 忽略自己发出的回声
      if (typeof m.seq === 'number') since = Math.max(since, m.seq);
      if (cfg.onMessage) cfg.onMessage(m);
    }
    function flush() {
      if (!ws || ws.readyState !== 1) return;
      while (queue.length) {
        try { ws.send(JSON.stringify(queue.shift())); } catch (e) { break; }
      }
    }
    function send(m) {
      if (stopped) return false;
      m = m || {};
      /* 不携带 room/key：房间归属完全由服务端按连接决定，杜绝伪造跨房间消息 */
      var out = { type: m.type, payload: m.payload, t: m.t, from: peer };
      if (transport === 'ws' && ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify(out)); return true; } catch (e) {}
      } else if (transport === 'poll') {
        pushHttp(out); return true;
      }
      if (queue.length < 12) queue.push(out);
      return false;
    }
    function pushHttp(out) {
      var body = JSON.stringify({
        room: room, role: role, key: key, peer: peer,
        type: out.type, payload: out.payload, t: out.t, from: out.from
      });
      fetch(withTicket(server + '/api/push', ticket), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.error) { lastError = j.error; emit(); }
      }).catch(function (e) { lastError = '推送失败：' + e.message; emit(); });
    }
    function pollLoop() {
      if (stopped || transport !== 'poll') return;
      pollAbort = new AbortController();
      fetch(withTicket(server + '/api/poll?room=' + encodeURIComponent(room) +
            '&role=' + role + '&peer=' + encodeURIComponent(peer) + '&since=' + since, ticket),
            { signal: pollAbort.signal })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          (j.messages || []).forEach(deliver);
          if (j.presence) deliver(j.presence);
          pollLoop();
        })
        .catch(function (e) {
          if (stopped || e.name === 'AbortError') return;
          lastError = '轮询中断，稍后重试'; emit();
          retryTimer = setTimeout(pollLoop, 1500);
        });
    }
    function startPolling(reason) {
      if (stopped || transport === 'poll') return;
      transport = 'poll'; connected = true;
      lastError = reason ? 'WebSocket 不可用，已切换 HTTP 长轮询' : '';
      emit(); flushHttpQueue(); pollLoop();
    }
    function flushHttpQueue() {
      while (queue.length) pushHttp(queue.shift());
    }
    function connect() {
      if (stopped) return;
      if (!server || !room) {
        lastError = '缺少房间号或中继地址'; transport = 'offline'; connected = false; emit(); return;
      }
      if (typeof WebSocket === 'undefined') { startPolling('浏览器不支持 WebSocket'); return; }
      var opened = false;
      try { ws = new WebSocket(wsUrl(server, { room: room, role: role, key: key, peer: peer }, ticket)); }
      catch (e) { startPolling(e.message); return; }
      var t = setTimeout(function () {
        if (!opened && !stopped) { try { ws.close(); } catch (e) {} startPolling('连接超时'); }
      }, 4000);
      ws.onopen = function () {
        if (stopped) return;
        opened = true; clearTimeout(t); transport = 'ws'; connected = true; lastError = ''; emit(); flush();
      };
      ws.onmessage = function (ev) { try { deliver(JSON.parse(ev.data)); } catch (e) {} };
      ws.onerror = function () {};
      ws.onclose = function () {
        clearTimeout(t);
        if (stopped) return;
        if (!opened) { startPolling('WebSocket 被拒绝'); return; }
        connected = false; transport = 'reconnecting'; lastError = '连接断开，正在重连'; emit();
        retryTimer = setTimeout(function () { if (!stopped && transport !== 'poll') connect(); }, 1800);
      };
    }
    function close() {
      stopped = true; connected = false; transport = 'offline';
      clearTimeout(retryTimer);
      if (pollAbort) { try { pollAbort.abort(); } catch (e) {} }
      if (ws) { try { ws.close(); } catch (e) {} }
      ws = null; queue.length = 0;
      emit();
    }
    return {
      connect: connect, close: close, send: send, peer: peer,
      status: function () {
        return { connected: connected, transport: transport, room: room, server: server, detail: lastError };
      }
    };
  }

  return {
    create: create, normServer: normServer, splitServer: splitServer,
    normRoom: normRoom, randomPeer: randomPeer, pageTicket: pageTicket
  };
});
/* RELAY-CLIENT-END */
