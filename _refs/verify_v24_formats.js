/* v24 端到端：浏览器内合成短视频 → 逐个格式真实烧录 → 校验容器签名 / 扩展名 / 转换标记。 */
const fs = require('fs');
const path = require('path');
const H = require('./cdp_helper');

const root = path.resolve(__dirname, '..');
const PORT = 9241;
const gen = fs.readFileSync(path.join(root, 'scorebug-generator.js'), 'utf8');
const burn = fs.readFileSync(path.join(root, 'video-burn.js'), 'utf8');
const pageFile = path.join(__dirname, 'v24_formats_page.html');
fs.writeFileSync(pageFile, `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script>\n${gen}\n</script>
<script>\n${burn}\n</script>
<script>
window.__runFormats = function (done) {
  var G = window.ScorebugBAS, B = window.ScorebugBurner;
  var out = { formats: B.listFormats(), results: [], steps: [] };
  if (!B.isSupported().ok) { done({ error: 'burner unsupported', supported: B.isSupported() }); return; }
  var c = document.createElement('canvas'); c.width = 320; c.height = 180;
  var x = c.getContext('2d');
  var stream = c.captureStream(25);
  var mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
  var rec = new MediaRecorder(stream, { mimeType: mime });
  var chunks = [], start = performance.now();
  rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
  function draw() {
    x.fillStyle = 'hsl(' + (Math.floor(performance.now() / 8) % 360) + ',70%,42%)';
    x.fillRect(0, 0, 320, 180);
    x.fillStyle = '#fff'; x.font = 'bold 22px Arial'; x.fillText('SCOREBUG V24', 18, 96);
  }
  rec.onstop = function () {
    var clip = new Blob(chunks, { type: mime });
    out.clipSize = clip.size; out.steps.push('clip_ready');
    if (clip.size < 1000) { done({ error: 'clip too small', out: out }); return; }
    var file = new File([clip], 'clip.webm', { type: 'video/webm' });
    var ids = ['webm-vp9', 'webm-vp8', 'mp4-h264', 'mkv-h264', 'mov-h264'];
    var events = [{ t: 0.35, field: 'balls', value: 2 }, { t: 0.7, field: 'strikes', value: 1 }];
    function one(i) {
      if (i >= ids.length) { out.steps.push('all_done'); done(out); return; }
      var id = ids[i];
      B.burn({
        file: file, initial: G.DEFAULT_STATE, events: events,
        options: G.DEFAULT_OPTIONS, duration: 1.1, format: id,
        onStatus: function () {},
        onDone: function (blob, meta) {
          blob.slice(0, 16).arrayBuffer().then(function (buf) {
            var b = new Uint8Array(buf);
            var hex = Array.prototype.map.call(b, function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
            out.results.push({
              id: id, size: blob.size, ext: meta.ext, mime: meta.mime,
              needsConversion: meta.needsConversion, targetExt: meta.targetExt,
              fallback: meta.fallback, head: hex.slice(0, 24),
              ascii4to8: String.fromCharCode.apply(null, b.slice(4, 8))
            });
            one(i + 1);
          });
        },
        onError: function (m) { out.results.push({ id: id, error: m }); one(i + 1); }
      });
    }
    one(0);
  };
  draw(); rec.start(200);
  var iv = setInterval(function () {
    draw();
    if (performance.now() - start > 1000) { clearInterval(iv); if (rec.state !== 'inactive') rec.stop(); }
  }, 40);
};
</script></body></html>`, 'utf8');

async function main() {
  let chrome = null, browser = null, page = null;
  try {
    chrome = H.launch(PORT, 'chromeV24formats', H.fileUrl(pageFile));
    const targets = await H.waitFor('http://127.0.0.1:' + PORT + '/json/list', 40, true);
    const t = targets.find(function (x) { return x.type === 'page' && /v24_formats_page/.test(x.url); });
    if (!t) throw new Error('page target missing');
    page = await H.connect(t.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    const data = await H.evalJS(page,
      'new Promise(function(resolve){ window.__runFormats(resolve); })', 150000);
    console.log('formats=' + data.formats.map(function (f) { return f.id + ':' + (f.native ? 'native' : 'convert') + ':' + f.ext; }).join(' | '));
    console.log('clip_size=' + data.clipSize);
    data.results.forEach(function (r) { console.log(JSON.stringify(r)); });
    const byId = {};
    data.results.forEach(function (r) { byId[r.id] = r; });
    const webmOK = byId['webm-vp9'] && byId['webm-vp9'].size > 1000 && /^1a45dfa3/.test(byId['webm-vp9'].head) && byId['webm-vp9'].ext === 'webm';
    const mp4OK = byId['mp4-h264'] && byId['mp4-h264'].size > 1000 && byId['mp4-h264'].ascii4to8 === 'ftyp' && byId['mp4-h264'].ext === 'mp4';
    const mkvOK = byId['mkv-h264'] && byId['mkv-h264'].size > 1000 && byId['mkv-h264'].ext === 'mkv';
    const movOK = byId['mov-h264'] && byId['mov-h264'].size > 1000 && byId['mov-h264'].needsConversion === true && byId['mov-h264'].targetExt === 'mov';
    const noErrors = data.results.every(function (r) { return !r.error; });
    console.log('webm_ok=' + webmOK, 'mp4_ok=' + mp4OK, 'mkv_ok=' + mkvOK, 'mov_convert_ok=' + movOK, 'no_errors=' + noErrors);
    const ok = data.clipSize > 1000 && webmOK && mp4OK && mkvOK && movOK && noErrors;
    console.log('FORMATS_V24_OK=' + ok);
    if (!ok) process.exitCode = 1;
  } finally {
    if (page) try { page.close(); } catch (e) {}
    if (browser) try { browser.close(); } catch (e) {}
    if (chrome) chrome.kill();
  }
}
main().catch(function (e) { console.error('FORMATS_V24_FAIL', e.message); process.exitCode = 1; });
