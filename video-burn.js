/* 本地视频烧录（纯浏览器，不上传）：Canvas 逐帧绘制视频 + 同一份 SVG 记分条。
 * MediaRecorder 直出浏览器原生支持的容器（WebM / MP4 / MKV 等）；
 * MOV / AVI 等不原生支持的容器先导出中间文件，再用 convert_video.py 本机转换。
 * 录制是实时的（需按视频时长播放一遍），请保持标签页在前台。
 */
(function (root, factory) {
  var G = (typeof module !== 'undefined' && module.exports)
    ? require('./scorebug-generator.js')
    : (root && root.ScorebugBAS);
  var api = factory(G);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root) root.ScorebugBurner = api;
})(typeof window !== 'undefined' ? window : null, function (G) {
  'use strict';

  var WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus',
              'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  var MP4 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'];
  var MKV = ['video/x-matroska;codecs=avc1', 'video/x-matroska;codecs=avc1,opus', 'video/x-matroska'];

  /* convertTo 为空 = 浏览器直出；否则先录制 mimes 里的中间容器，再本机转换为目标扩展名 */
  var FORMATS = [
    { id: 'webm-vp9', label: 'WebM · VP9 + Opus（原生，推荐）', mimes: WEBM.slice(0, 1).concat(WEBM.slice(2)), convertTo: '' },
    { id: 'webm-vp8', label: 'WebM · VP8 + Opus（原生，兼容性最好）', mimes: [WEBM[1], WEBM[3], WEBM[4]], convertTo: '' },
    { id: 'mp4-h264', label: 'MP4 · H.264 + AAC（原生，播放器通用）', mimes: MP4, convertTo: '' },
    { id: 'mkv-h264', label: 'MKV · H.264（原生）', mimes: MKV, convertTo: '' },
    { id: 'mov-h264', label: 'MOV · H.264（导出后本机转换）', mimes: MP4, convertTo: 'mov' },
    { id: 'avi-mpeg4', label: 'AVI · MPEG-4（导出后本机转换）', mimes: MP4, convertTo: 'avi' }
  ];

  function hasMR() { return typeof MediaRecorder !== 'undefined'; }
  function supported(mime) {
    return hasMR() && !!MediaRecorder.isTypeSupported && !!mime && MediaRecorder.isTypeSupported(mime);
  }
  function firstSupported(list) {
    for (var i = 0; i < list.length; i++) if (supported(list[i])) return list[i];
    return '';
  }
  function extFromMime(mime) {
    if (/mp4/i.test(mime)) return 'mp4';
    if (/matroska|webm.*mkv/i.test(mime)) return 'mkv';
    return 'webm';
  }
  function isSupported() {
    if (typeof document === 'undefined' || !hasMR())
      return { ok: false, reason: '当前浏览器不支持 MediaRecorder，请用 Chrome / Edge 桌面版。' };
    if (typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream)
      return { ok: false, reason: '当前浏览器不支持 canvas.captureStream，请用 Chrome / Edge 桌面版。' };
    if (typeof HTMLVideoElement === 'undefined' ||
        (!HTMLVideoElement.prototype.captureStream && !HTMLVideoElement.prototype.mozCaptureStream))
      return { ok: false, audio: false, okWithoutAudio: true, reason: '视频音轨捕获不可用，将导出无声音的视频。' };
    return { ok: true, audio: true, reason: '' };
  }
  function resolveFormat(id) {
    var f = FORMATS.filter(function (x) { return x.id === id; })[0] || FORMATS[0];
    var nativeMime = firstSupported(f.mimes);
    var mime = nativeMime || firstSupported(WEBM) || '';
    return {
      id: f.id, label: f.label, mime: mime, ext: extFromMime(mime) || 'webm',
      native: !!nativeMime, fallback: !nativeMime,
      targetExt: f.convertTo || '', needsConversion: !!f.convertTo
    };
  }
  function listFormats() {
    return FORMATS.map(function (f) {
      var r = resolveFormat(f.id);
      return {
        id: r.id, label: r.label, ext: r.ext, targetExt: r.targetExt,
        needsConversion: r.needsConversion, native: r.native, fallback: r.fallback,
        supported: !!r.mime, mime: r.mime,
        note: r.needsConversion ? ('先导出 .' + r.ext + '，再本机转成 .' + r.targetExt)
              : (r.fallback ? '当前浏览器不支持该容器，将回退 WebM' : '浏览器原生直出 .' + r.ext)
      };
    });
  }
  function defaultFormatId() { return resolveFormat('webm-vp9').native ? 'webm-vp9' : 'mp4-h264'; }
  function convertCommand(filename, targetExt) {
    return 'python convert_video.py "' + filename + '" --to ' + (targetExt || 'mp4');
  }
  function svgMarkup(state, options, fitState) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 562.5" width="1000" height="562.5">' +
      G.renderSVG(state, options, { fieldBg: false, fitState: fitState }) + '</svg>';
  }
  function makeImage(svg) {
    var img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return img;
  }
  function stateSig(s) {
    return [s.awayName, s.awayScore, s.homeName, s.homeScore, s.inning, s.half,
            s.balls, s.strikes, s.outs, s.b1, s.b2, s.b3].join('|');
  }
  function downloadBlob(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  /* cfg: { file, initial, events, options, duration, format, maxWidth,
   *        onStatus, onProgress, onDone, onError } */
  function burn(cfg) {
    var cancelled = false, finished = false;
    var video = null, canvas = null, ctx = null, objUrl = null;
    var recorder = null, stream = null, vstream = null, raf = 0;
    var chunks = [], currentImg = null, lastSig = '', mimeUsed = '';
    var W = 1280, H = 720, scale = 1, drawH = 720, drawY = 0;
    var durationLimit = Math.max(1, Number(cfg.duration) || 600);
    var fitState = G.worstFitState(cfg.initial, cfg.events || []);
    var res = resolveFormat(cfg.format);
    var candidates = [];
    [res.mime].concat(res.needsConversion ? MP4 : []).concat(WEBM).concat([''])
      .forEach(function (m) { if (m && candidates.indexOf(m) < 0) candidates.push(m); });
    if (!candidates.length) candidates.push('');

    function status(m) { if (cfg.onStatus) cfg.onStatus(m); }
    function fail(m) { cleanup(); if (cfg.onError) cfg.onError(m); }
    function cleanup() {
      if (raf) cancelAnimationFrame(raf), raf = 0;
      try { if (video) video.pause(); } catch (e) {}
      [stream, vstream].forEach(function (st) {
        if (st && st.getTracks) st.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      });
      if (video && video.parentNode) video.parentNode.removeChild(video);
      if (objUrl) URL.revokeObjectURL(objUrl), objUrl = null;
      video = null; stream = null; vstream = null; recorder = null;
    }
    function finish() {
      if (finished) return;
      finished = true;
      if (raf) cancelAnimationFrame(raf), raf = 0;
      try { video.pause(); } catch (e) {}
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else cleanup();
    }
    function frame() {
      if (finished || cancelled || !video) return;
      var t = video.currentTime;
      try { ctx.drawImage(video, 0, 0, W, H); } catch (e) {}
      var s = G.stateAtTime(cfg.initial, cfg.events || [], t);
      var sig = stateSig(s);
      if (sig !== lastSig) {
        lastSig = sig;
        var img = makeImage(svgMarkup(s, cfg.options, fitState));
        img.onload = function () { currentImg = img; };
      }
      if (currentImg && currentImg.complete && currentImg.naturalWidth)
        ctx.drawImage(currentImg, 0, drawY, W, drawH);
      if (cfg.onProgress) cfg.onProgress(Math.min(1, t / durationLimit), t);
      if (video.ended || t >= durationLimit - 0.04) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }

    /* 某些浏览器对 MP4/MKV 的声明支持与音轨组合不一致：出错且尚无数据时自动回退下一个候选容器 */
    function startRecorder(idx) {
      var c = idx < candidates.length ? candidates[idx] : '';
      var opts = c ? { mimeType: c, videoBitsPerSecond: 8000000 } : { videoBitsPerSecond: 8000000 };
      try { recorder = new MediaRecorder(stream, opts); }
      catch (e) {
        if (idx + 1 < candidates.length) return startRecorder(idx + 1);
        fail('录制器创建失败：' + e.message); return;
      }
      mimeUsed = c || '';
      chunks = [];
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = function () {
        if (cancelled) { cleanup(); return; }
        var ext = extFromMime(mimeUsed) || 'webm';
        var blob = new Blob(chunks, { type: mimeUsed || 'video/webm' });
        if (cfg.onDone) cfg.onDone(blob, {
          audio: (stream.getAudioTracks ? stream.getAudioTracks().length : 0) > 0,
          width: W, height: H, duration: durationLimit,
          mime: mimeUsed, ext: ext, formatId: res.id, label: res.label,
          targetExt: res.targetExt, needsConversion: res.needsConversion,
          fallback: mimeUsed !== res.mime
        });
        cleanup();
      };
      recorder.onerror = function (e) {
        if (!finished && !cancelled && !chunks.length && idx + 1 < candidates.length) {
          recorder.onstop = null; recorder.onerror = null;
          try { if (recorder.state !== 'inactive') recorder.stop(); } catch (e2) {}
          status('该容器录制失败，自动回退到 ' + (candidates[idx + 1] || '浏览器默认') + '…');
          startRecorder(idx + 1); return;
        }
        fail('录制出错：' + (e.error && e.error.message ? e.error.message : '请改用 WebM 格式重试'));
      };
      try { recorder.start(1000); }
      catch (e) {
        if (idx + 1 < candidates.length) return startRecorder(idx + 1);
        fail('录制启动失败：' + e.message); return;
      }
      status('录制中（' + (mimeUsed || '浏览器默认容器') + '）' +
        (stream.getAudioTracks && stream.getAudioTracks().length ? '（含原声）' : '（静音）') +
        '，请勿切到后台标签页。');
    }

    (function start() {
      var probe = isSupported();
      if (!probe.ok && !probe.okWithoutAudio) { fail(probe.reason); return; }
      video = document.createElement('video');
      video.playsInline = true; video.preload = 'auto';
      video.style.cssText = 'position:fixed;left:-99999px;width:2px;height:2px;opacity:0';
      document.body.appendChild(video);
      objUrl = URL.createObjectURL(cfg.file);
      video.src = objUrl;
      status('正在读取本地视频元数据…');
      video.addEventListener('loadedmetadata', function () {
        var real = isFinite(video.duration) ? video.duration : durationLimit;
        durationLimit = Math.min(real, durationLimit) || real;
        var maxW = Number(cfg.maxWidth) || 1920;
        W = Math.min(maxW, video.videoWidth || 1280);
        H = Math.round(W * (video.videoHeight || 720) / (video.videoWidth || 1280));
        canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        ctx = canvas.getContext('2d');
        scale = W / 1000;
        drawH = 562.5 * scale;
        drawY = Math.max(0, (H - drawH) / 2);
        var first = G.stateAtTime(cfg.initial, cfg.events || [], 0);
        lastSig = stateSig(first);
        var img0 = makeImage(svgMarkup(first, cfg.options, fitState));
        img0.onload = function () { currentImg = img0; };
        status('开始录制：' + W + '×' + H + '，约 ' + Math.round(durationLimit) + ' 秒，按视频原速播放一遍。');
        var p;
        try { video.currentTime = 0; p = video.play(); } catch (e) { fail('无法播放该视频：' + e.message); return; }
        Promise.resolve(p).then(function () {
          try {
            vstream = video.captureStream ? video.captureStream() :
                      (video.mozCaptureStream ? video.mozCaptureStream() : null);
          } catch (e) { vstream = null; }
          stream = canvas.captureStream(30);
          if (vstream && vstream.getAudioTracks) {
            vstream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
          }
          startRecorder(0);
          raf = requestAnimationFrame(frame);
        }).catch(function (e) { fail('浏览器拒绝播放视频：' + e.message); });
      }, { once: true });
      video.addEventListener('error', function () {
        fail('视频解码失败，请换用 Chrome / Edge 支持的 MP4 / WebM / MOV(H.264) 文件。');
      }, { once: true });
    })();

    return {
      stop: function () {
        cancelled = true;
        status('已取消，本次录制不会导出文件。');
        finish();
      },
      isRunning: function () { return !finished && !cancelled; }
    };
  }

  return {
    isSupported: isSupported, burn: burn, downloadBlob: downloadBlob, svgMarkup: svgMarkup,
    FORMATS: FORMATS, listFormats: listFormats, resolveFormat: resolveFormat,
    defaultFormatId: defaultFormatId, convertCommand: convertCommand
  };
});
