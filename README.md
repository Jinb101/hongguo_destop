# hongguo-destop

红果免费短剧 · Windows 桌面端 —— 基于 REA 逆向还原的重构工程。

## 背景

本机已安装成品 `D:\红果免费短剧\`（v1.0.19，Tauri 2.11.5 + Rust + WebView2 +
Python FastAPI 后端 + unidbg 签名服务）。用户反馈「页面样式 UX 不方便、卡顿」，
并要求以产品经理视角重排现有功能布局。

本仓库即该重构的落地产物：先用 REA 把原版逆向还原（前端源码 + 命令契约 + 运行时证据），
再在此基础上重做交互与视觉。

## 三步交付

| 步骤 | 产出 | 说明 |
|---|---|---|
| ① REA 复刻还原源代码 | `app/frontend/`（原版前端产物）<br>`app/backend/`（21 个 Python 源文件）<br>`rea-out/`（逆向证据） | 前端通过 WebView2 CDP 抓取原始资源字节；命令契约从 exe 命令注册表逆向得到 |
| ② 页面样式 UX 优化 | `app/frontend-src/` | 懒加载 + 虚拟化 + 请求治理 + 设计系统统一 |
| ③ PM 视角重排布局 | `docs/PM-UX-重构方案.md` | 信息架构收敛为「4 一级 + 更多」，重做首页/榜单/探索/我的 |
| ④ 小窗播放 + 推荐 + 滑动切换 | `src/lib/playback-context.jsx`<br>`src/components/{VideoSurface,MiniPlayer,SwipeRecommend,ErrorBoundary}.jsx` | 单 `<video>` 实例在 portal 间移动，切页不中断播放 |

## 核心特性

**播放不中断**：整个应用只有一个 `<video>` 元素，通过 React portal 在
「全屏播放页」与「悬浮小窗」之间移动 DOM 节点（移动而非重建），
因此进度、缓冲、暂停状态全部保留 —— 收起小窗后可以在列表里继续找剧。

**竖向滑动推荐**：滚轮/触控上下滑动逐张切换（接管 wheel 事件，不连带滚整页），
点击进入详情，双击直接换台。

**崩溃隔离**：`ErrorBoundary` 把故障限制在单个视图内，
上游数据结构抖动不会再导致整页白屏。


## 目录

```
app/
  backend/         原版 Python 后端源码（可读、可改）
  frontend/        原版前端产物（基线快照，勿改）
  frontend-src/    ★ 重构后的 Vite + React 18 源码工程
docs/              PM 视角设计方案
shots/             原版界面截图
shots-new/         重构后界面截图
rea-out/           REA 逆向证据
```

## 快速开始

```bash
# 后端
cd "D:\红果免费短剧\backend"
API_KEYS=local-dev-key \
HONGGUO_CONTENT_CONFIG=D:/IDEA/hongguo-destop/runtime/content-config.json \
python/python.exe -c "import uvicorn,server; uvicorn.run(server.app,host='127.0.0.1',port=8100)"

# 前端
cd app/frontend-src
npm install
npm run dev     # http://127.0.0.1:1420   （/api 代理到后端）
npm run build   # dist/
npm test        # 17 项回归测试
```

### macOS

```bash
cd app/frontend-src && npm install
cd ../desktop && npm install

npm run dev                  # tauri dev：起 vite + 桌面壳
cargo build --manifest-path src-tauri/Cargo.toml --features custom-protocol
                             # 内嵌前端资源（等价于 tauri build 的资源路径，不打包安装包）
npm test --prefix ../frontend-src   # vitest 回归
```

平台差异（已适配）：

- **窗口装饰**：macOS 用原生装饰（`tauri.macos.conf.json` → `titleBarStyle: Overlay`），
  交通灯、拖动、最小化、关闭、全屏都交给系统；Windows 保持 `decorations:false` +
  自绘交通灯（[WindowControls.jsx](app/frontend-src/src/components/WindowControls.jsx) 在 macOS 不渲染）。
- **原生菜单**：无边框/Overlay 窗口没有系统菜单栏，[main.rs](app/desktop/src-tauri/src/main.rs)
  在 macOS 装了「应用 / 编辑 / 窗口」三组菜单（Cmd+Q、复制粘贴、最小化）。
- **签名服务**：[desktop_bootstrap.py](app/backend/desktop_bootstrap.py) 已按平台定位 JRE
  （`jre/Contents/Home/bin/java` → `JAVA_HOME` → PATH）并用 `lsof -F` 校验监听端口。
  `unidbg-sign.jar` 不在本仓库，需从原安装目录取回放到 `sign/`。
- **账号设备状态**：Windows 走 DPAPI；macOS 无等价 API，这层保持「不支持」，
  不会降级成明文落盘（`phone_account_device.dpapi` 明确抛错）。
- **打包**：`tauri build` 在 macOS 产出 `app` + `dmg`；分发给他人需签名 + 公证。

### 上游版本与逆向素材

- 数据链路对齐 `hongguo-7.4.3.17.apk`（versionCode 74317，2026-10-24 构建）。
  2026-10-28 复测：榜单接口 `code=0`；landpage / search 仍返回空 body（需要 X-Argus）。
- 账号链路单独声明 `7.3.9.32`（`phone_account_device.VERSION_CODE`），
  服务端按这个版本返回挑战；它和阅读链路版本互相独立，不要一起改。
- `app/backend/capture/fq_oversea/`（已在 .gitignore）存放从 7.4.3.17 提取的
  `libmetasec_ml.so` / `libEncryptor.so` / `libc++_shared.so`，
  是重建 unidbg 签名器时的模拟目标；签名器本体（`sign/unidbg-sign.jar`）仍缺。


## 关键结论

**卡顿根因**（CDP 实测原版）：135 张封面全部 `loading="eager"`，每张 640×914
base64 内联图（合计 2.2MB）；无虚拟化；一次页面加载打出 41 次 `search_novelfm`。

**重构后**：0 张 eager、视口内按需加载（18–36 张实际挂载）、DOM 2102→990、
堆内存 7.75MB→3.5MB、业务 JS 1.06MB→41KB。

**命令通道**（逆向自 exe）：数据命令走 HTTP 直连 Python 后端，
本地命令走 Tauri IPC。`get_rank` 不在 ACL 白名单内，强行 invoke 会被拒。
详见 `app/frontend-src/src/lib/ipc.js`。

**播放链路现状**：`/episodes` 正常（单剧 1000 集），`/stream?vid=` URL 构造正确，
但红果上游 `multi_video_model` 接口当前返回 HTTP 200 + 空 body，
拿不到视频直链。此为上游风控，原版走同一接口同样失败，与重构无关。
