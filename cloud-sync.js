/* 云端房间快照：把线上房间的比赛状态 / 时间轴写进 WorkBuddy 云数据库，
 * 让控制器与 OBS 叠加层在换设备、刷新、控制器短暂离线后仍能恢复同一场比赛。
 * 只有调用 saveRoom / loadRoom 才会发起请求；SDK 未加载（离线静态版）时明确返回未启用。
 * CLOUD-SYNC-START / END 标记供发布检查脚本识别云端代码块。 */
/* CLOUD-SYNC-START */
(function (root) {
  'use strict';
  var CFG = root.SCOREBUG_CLOUD_CONFIG || null;
  var TABLE = 'scorebug_rooms';
  var client = null, initErr = null;

  function fail(code, message) { return { ok: false, code: code, message: message }; }
  function classify(err) {
    var code = err && (err.code || err.status || err.statusCode);
    var msg = (err && (err.message || err.msg)) || String(err || '');
    if (code === 401 || /credential|token.*invalid|unauthorized/i.test(msg))
      return fail('credentials', '云服务凭证不可用，请确认应用已开启云服务。');
    if (code === '42P01') return fail('table-missing', '云端数据表尚未创建。');
    if (code === '42501') return fail('permission', '没有权限访问该房间数据。');
    if (code === '23505') return fail('conflict', '房间快照冲突，请重试。');
    if (/quota|credit|exhaust|rate.?limit/i.test(msg))
      return fail('quota', '云服务额度或频率受限，请在应用管理中查看配额。');
    if (/network|fetch|timeout|failed to fetch|load failed/i.test(msg))
      return fail('network', '网络不可用，云端同步已跳过；本地功能不受影响。');
    return fail('unknown', '云端同步失败：' + msg);
  }
  function ensure() {
    if (client) return { ok: true };
    if (initErr) return initErr;
    if (!CFG || !CFG.endpoint || !CFG.publishableKey) {
      initErr = fail('not-configured', '当前为离线静态版，未开启云服务。');
      return initErr;
    }
    if (!root.WorkBuddyCloud || typeof root.WorkBuddyCloud.createWorkBuddyCloud !== 'function') {
      initErr = fail('sdk-missing', '云服务 SDK 未加载，无法同步。');
      return initErr;
    }
    try {
      /* 唯一的客户端初始化点：endpoint / publishableKey / oauthRelayBaseUrl 全部来自 publicConfig */
      client = root.WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: CFG.endpoint,
        oauthRelayBaseUrl: CFG.oauthRelayBaseUrl,
        publishableKey: CFG.publishableKey
      });
    } catch (e) { initErr = classify(e); return initErr; }
    return { ok: true };
  }
  function normRoom(v) {
    return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }
  function simpleHash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(16);
  }
  function hashKey(key) {
    var s = String(key || '');
    if (!s) return Promise.resolve('');
    if (root.crypto && root.crypto.subtle && root.TextEncoder) {
      return root.crypto.subtle.digest('SHA-256', new root.TextEncoder().encode(s))
        .then(function (buf) {
          var b = new Uint8Array(buf), out = '';
          for (var i = 0; i < b.length; i++) out += ('0' + b[i].toString(16)).slice(-2);
          return out;
        })['catch'](function () { return simpleHash(s); });
    }
    return Promise.resolve(simpleHash(s));
  }
  function loadRoom(room) {
    var id = normRoom(room);
    if (id.length < 4) return Promise.resolve(fail('bad-room', '房间号至少 4 位字母或数字。'));
    var ok = ensure(); if (!ok.ok) return Promise.resolve(ok);
    return client.database.from(TABLE)
      .select('room_id,control_key_hash,state,events,options,duration,revision,updated_at')
      .eq('room_id', id).maybeSingle()
      .then(function (r) {
        if (r.error) return classify(r.error);
        return { ok: true, data: r.data || null };
      })['catch'](function (e) { return classify(e); });
  }
  function saveRoom(room, payload, key) {
    var id = normRoom(room);
    if (id.length < 4) return Promise.resolve(fail('bad-room', '房间号至少 4 位字母或数字。'));
    var ok = ensure(); if (!ok.ok) return Promise.resolve(ok);
    var p = payload || {};
    return hashKey(key).then(function (kh) {
      return loadRoom(id).then(function (cur) {
        if (!cur.ok) return cur;
        var prev = cur.data;
        /* 已有控制器占用房间时，控制密钥不匹配一律拒绝覆写 */
        if (prev && prev.control_key_hash && kh && prev.control_key_hash !== kh)
          return fail('key-mismatch', '该房间已被其他控制器占用，控制密钥不匹配。');
        var rev = (prev ? Number(prev.revision) || 0 : 0) + 1;
        var row = {
          room_id: id,
          control_key_hash: kh,
          state: p.state || {},
          events: Array.isArray(p.events) ? p.events : [],
          options: p.options || {},
          duration: Math.max(1, Number(p.duration) || 600),
          revision: rev,
          updated_at: new Date().toISOString()
        };
        return client.database.from(TABLE).upsert(row, { onConflict: 'room_id' })
          .select('room_id,revision,updated_at')
          .then(function (r) {
            if (r.error) return classify(r.error);
            var rows = Array.isArray(r.data) ? r.data : [];
            if (!rows.length) return fail('permission', '云端写入未生效，可能被权限策略拦截。');
            return { ok: true, data: rows[0], revision: rev };
          })['catch'](function (e) { return classify(e); });
      });
    })['catch'](function (e) { return classify(e); });
  }
  function status() {
    var s = ensure();
    return {
      configured: !!(CFG && CFG.endpoint && CFG.publishableKey),
      sdkLoaded: !!(root.WorkBuddyCloud && root.WorkBuddyCloud.createWorkBuddyCloud),
      ready: s.ok,
      code: s.ok ? '' : s.code,
      message: s.ok ? '云服务已就绪' : s.message
    };
  }
  root.ScorebugCloud = {
    ensure: ensure, loadRoom: loadRoom, saveRoom: saveRoom,
    normRoom: normRoom, status: status
  };
})(window);
/* CLOUD-SYNC-END */
