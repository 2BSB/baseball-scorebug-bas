/* 用无头 Chrome 截取手机 / 平板视口下的移动端控制页，仅连本机服务。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const H = require('./cdp_helper');

const root = path.resolve(__dirname, '..');
const PORT = 3201;
const BASE = 'http://127.0.0.1:' + PORT;
const OUT = path.join(root, '界面截图');
let srv = null, chrome = null;

async function shot(page, file) {
  const r = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(r.result.data, 'base64'));
  console.log('  ' + file);
}
async function main() {
  srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(root, 'online-app'),
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore'
  });
  await H.waitFor(BASE + '/api/health', 40, true);
  chrome = H.launch(9283, 'chromeV27shot', 'about:blank');
  const ver = await H.waitFor('http://127.0.0.1:9283/json/version', 40, true);
  const browser = await H.connect(ver.webSocketDebuggerUrl);
  const targets = await H.waitFor('http://127.0.0.1:9283/json/list', 40, true);
  const t = targets.find(function (x) { return x.type === 'page'; });
  const page = await H.connect(t.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Page.navigate', { url: BASE + '/mobile-control.html?room=SHOT26&key=SHOTKEY123456' });
  await H.sleep(3300);   /* 等「已加入房间」提示气泡自动消失，避免遮挡按钮 */
  await H.evalJS(page, "document.getElementById('toast').classList.remove('show')");
  await H.sleep(250);
  console.log('移动端截图:');
  await shot(page, '13-手机控制页-首屏.png');

  const h = await H.evalJS(page, 'document.documentElement.scrollHeight');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: Math.min(Math.ceil(h) + 30, 4200), deviceScaleFactor: 2, mobile: true
  });
  await H.sleep(500);
  await shot(page, '14-手机控制页-全页.png');

  await page.send('Emulation.setDeviceMetricsOverride', { width: 834, height: 1112, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await H.sleep(600);
  await shot(page, '15-平板控制页.png');
  page.close(); browser.close();
}
main().catch(function (e) { console.error(e); process.exitCode = 1; }).finally(function () {
  if (chrome) chrome.kill();
  if (srv) srv.kill();
});
