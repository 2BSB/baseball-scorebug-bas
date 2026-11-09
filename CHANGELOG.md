# 更新说明

项目作者：**狗王IB** · [B 站主页](https://space.bilibili.com/150585) · [GitHub 仓库](https://github.com/2BSB/baseball-scorebug-bas)

> 版本号只用于区分功能批次，不代表 GitHub Release / Tag。所有版本均为同一个单文件网页工具的连续迭代。
> 遇到使用问题，欢迎在 [GitHub Issues](https://github.com/2BSB/baseball-scorebug-bas/issues) 留言，或通过 B 站后台私信作者。

---

## v2.6 · 2026-11-09 · 作者信息与全量发布

**本次发布**

- 网页顶部新增作者栏，页面底部新增「关于作者 · 问题反馈」区块：项目作者 **狗王IB**、[B 站主页](https://space.bilibili.com/150585)、[GitHub 仓库](https://github.com/2BSB/baseball-scorebug-bas)、[Issues 留言](https://github.com/2BSB/baseball-scorebug-bas/issues) 与 B 站后台私信入口。链接只是普通超链接，**不会自动发起任何请求**，点击才在新标签页打开。
- 新增本文件 `CHANGELOG.md`，并按批次补齐历史更新记录；`README.md` 同步修订（发布状态、文件清单、界面预览、反馈渠道）。
- 把之前仅保存在本地的增强内容**全量同步到 GitHub**：线上房间中继与云服务模块、直播叠加层、视频烧录导出、格式转换脚本、界面截图与验证脚本。
- GitHub Pages 干净静态版（`docs/` / `public-site/`）仍由构建脚本**剔除全部云服务代码**，继续维持「零外链脚本、零持久化、不主动联网」的隐私承诺；线上应用版保留云服务与中继能力。
- 叠加层（OBS 输出画面）**不显示**作者信息，避免污染直播画面。

---

## v2.5 · 2026-11-09 · 云服务接入

- 为应用「棒球计分直播中控」开通 WorkBuddy Cloud Service，接入 Database：新建 `public.scorebug_rooms` 表（JSONB 快照 + `revision`），启用 RLS 与按房间隔离的读写策略。
- 新增 `cloud-sdk.global.js`（内联 SDK）、`cloud-config.js`（仅 `publicConfig` 公开字段）、`cloud-sync.js`（`window.ScorebugCloud`：保存 / 恢复 / 错误分类）。
- 控制器增加「保存到云端 / 从云端恢复」，状态变化节流 2.5 秒写入；叠加层加入房间时读取云端快照，之后每 20 秒检查 `revision`，作为 WebSocket / 长轮询之外的兜底。
- 端到端验证：写入读回、跨页面恢复、房间隔离、错误控制密钥拒绝、干净版无云代码，本地与公网复测全部通过。

## v2.4 · 2026-11-09 · 线上直播叠加层与多人隔离

- 直播叠加层由本机工具升级为**线上房间**：零依赖 Node 服务 `online-app/server.js`，WebSocket `/ws` + HTTP 长轮询兜底，房间号由服务端绑定、控制密钥鉴权、内存转发、空闲 30 分钟回收。
- 新增 `relay-client.js`（`window.ScorebugRelay`）、`live-overlay.html`（1920×1080 透明背景，OBS 浏览器源可直接加载）；`H` 隐藏面板、空格暂停、←/→ ±5 秒。
- 用**两个独立 Chrome 实例**模拟两位主播同时开播，验证跨设备控制不串台、跨房间伪造被拒、HTTP 轮询兜底；线上公网页面复测通过。
- 删除字幕导出（SRT / WebVTT / ASS）全部代码与文档。
- 视频导出增加格式选择：WebM（VP9 / VP8）、**MP4（H.264 + AAC）**、MKV；MOV / AVI 先导出 MP4 中间文件，再用本机 `convert_video.py` + ffmpeg 转换。

## v2.3 · 2026-11-09 · 本地增强三项

- 新增可被直播软件识别的透明叠加层（本机版）与本地快照 / URL hash 传数据。
- 新增视频烧录导出：`canvas.captureStream` + `MediaRecorder`，逐帧把同一份 SVG 记分条叠加到视频画面。
- 新增字幕导出（后续按需求在 v2.4 删除）。

## v2.2 · 2026-11-08 · 纯白 B 字母与布局修正

- `B` 标签由淡蓝白 `0xDCEBFF` 改为纯白 `0xFFFFFF`，与 `S` 及球数数字统一。
- 修复「上下半局」单选项换行错位：`.fold .row > label` 由后代选择器改为直接子元素选择器，单选组强制 `nowrap`。

## v2.1 · 2026-11-08 · 字体大小与球数黑底

- 新增「字体大小」模块：整体字号、队名/比分字号（60%–140%）、舞台工具栏滑杆双向同步、80/100/120% 预设；默认开启**两位数自动避让**。
- 好球 / 坏球两行的底色改为可配置的黑色（默认 `#0B0B0C`），未点亮空点暗灰、点亮后纯白。

## v2.0 · 2026-11-08 · 隐私清理与 GitHub Pages

- 清空网页预填内容、示例数据与缓存：不写 Cookie / localStorage / sessionStorage / IndexedDB，不预置视频链接，页面默认不请求任何播放器。
- 新增 `public-site/` 与 `docs/` 干净静态发布目录，构建脚本强制检查外链脚本、存储调用、网络请求与示例数据；上线 GitHub Pages。
- 移除本地模型识别接口，改为「在线播放器 + 时间轴对照编辑」：B 站链接解析、时间码换算、投放时间对齐、事件自动前移。

## v1.x · 2026-11-08 · 计分条与界面迭代

- 依据 [BAS 官方指南](https://bilibili.github.io/bas/#/guide) 生成 `def text` / `def path` / `set` / `then set` / `duration` 脚本：队名、比分、局数、垒包、出局数、好坏球数。
- 取消 ABS 挑战次数，改为 B 行「三坏」、S 行「两好」；位置偏移支持贴右下角；队名底色可取色；上垒菱形改纯白。
- 效果预览把视频画面与 BAS 弹幕叠加；SVG 预览与「真实 BAS 引擎渲染」双模式（`file://` 下关闭 Blob Worker）。
- 比赛数据分组可折叠、时间轴贴近播放器、记分轴不越界、记分条整体缩小并等比缩放。
- 修复半局错位、B 站分 P 跳转、SVG 背景遮挡视频、动态 `fillColor` / `fontSize` 受限等问题。
