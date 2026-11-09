/* 无头 Chrome / CDP 小工具，供 v24 验证脚本复用。 */
const { spawn } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function waitFor(url, tries, asJson) {
  for (var i = 0; i < (tries || 40); i++) {
    try {
      var r = await fetch(url);
      if (r.ok) return asJson ? await r.json() : true;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('endpoint not ready: ' + url);
}
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise(function (resolve, reject) {
    ws.onopen = resolve;
    ws.onerror = function (e) { reject(new Error('cdp websocket error')); };
    setTimeout(function () { reject(new Error('cdp websocket timeout')); }, 10000);
  });
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = function (ev) {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  };
  return {
    events: events,
    send: function (method, params) {
      const id = ++seq;
      return new Promise(function (resolve) {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      });
    },
    close: function () { ws.close(); }
  };
}
async function evalJS(conn, expression, timeout) {
  const r = await conn.send('Runtime.evaluate', {
    expression: expression, returnByValue: true, awaitPromise: true, timeout: timeout || 30000
  });
  if (r.error) throw new Error(JSON.stringify(r.error));
  if (r.result && r.result.exceptionDetails)
    throw new Error('JS exception: ' + JSON.stringify(r.result.exceptionDetails));
  return r.result && r.result.result && r.result.result.value;
}
function launch(port, name, url, extraArgs) {
  const args = [
    '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required', '--remote-allow-origins=*',
    '--remote-debugging-port=' + port, '--window-size=1400,1000',
    '--user-data-dir=' + path.join(__dirname, name)
  ].concat(extraArgs || []).concat([url]);
  return spawn(CHROME, args, { stdio: 'ignore' });
}
function fileUrl(p) { return pathToFileURL(p).href; }

module.exports = { CHROME, sleep, waitFor, connect, evalJS, launch, fileUrl };
