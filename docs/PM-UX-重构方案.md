# 红果免费短剧 · 桌面端 UX 重构方案

> 版本：v1.0 · 2026-10-24
> 基线：`D:\红果免费短剧\hongguo-desktop-companion.exe`（v1.0.19，Tauri 2.11.5 + Rust + WebView2）
> 重构实现：`app/frontend-src/`（Vite + React 18）

---

## 0. 一句话结论

原版的问题不是"不好看"，而是**导航语义重复 + 渲染无节制**这两件事叠加，
导致用户既不知道该点哪里，又在每次点击后等很久。
本次重构用**信息架构收敛**和**渲染治理**两条线同时解决，实测把
「135 张封面全量 eager 加载」降到「视口内按需加载」，堆内存从 7.75MB 降到 3.5MB。

---

## 1. 逆向还原出的产品事实（决策依据）

### 1.1 技术架构

| 层 | 实现 | 说明 |
|---|---|---|
| 壳 | Tauri 2.11.5 + Rust | 窗口、托盘、全局快捷键、更新器 |
| 前端 | Vite + React 18 | 打包产物 `index-CTpIsaLU.js` 1.06MB / `index-BrrRYD-G.css` 78KB |
| 后端 | Python 3.11 + FastAPI（uvicorn） | 21 个 `.py`，签名服务为 unidbg Java |
| 播放 | 本地解密 + HLS 转封装 | ffmpeg 8.1.2 / libx265 / svtav1 |
| 封面 | `/img` 代理 | HEIC → JPEG（Pillow） |

### 1.2 命令通道（逆向自 exe 命令注册表 + CSP）

原版并非所有调用都走 IPC，这一点决定了重构的架构选择：

- **本地命令**（收藏/历史/设置/诊断/二维码/账号）→ Rust 实现，走 Tauri IPC。
- **数据命令**（榜单/搜索/选集/封面）→ **HTTP 直连 Python 后端**。
  证据：exe 内 CSP 明确放行 `connect-src ... http://127.0.0.1:8000`；
  且 `get_rank` 不在 ACL 白名单内，强行 invoke 会得到
  `Command get_rank not allowed by ACL`。

参数契约（从 exe 的命令注册表逆向得到，非猜测）：

```
search_explorer      { query, page, mode }
search_novelfm       { query, page, mode }
get_series_cover     { seriesId, title }
get_rank             { rankType, refresh, page }
get_new_releases     { genre, ranked }
get_category         { filters, page }
get_series           { seriesId }
get_recommendations  { tasteTags }
manage_playback_cache{ action, limit }
```

> 重构实现见 `app/frontend-src/src/lib/ipc.js`，
> `dispatch()` 按上述分类选择通道，与原版行为一致。

---

## 2. 现状问题清单（PM 视角）

### P0 — 渲染无节制（"卡顿"的根因）

CDP 实测原版首页：

| 指标 | 原版 | 重构后 |
|---|---|---|
| 封面图总数 | 135 | 72 |
| `loading="eager"` | **135（全部）** | **0** |
| 实际挂载 src 的图 | 135 | **18–36（仅视口内）** |
| DOM 节点 | 2102 | 983–1001 |
| JS 堆内存 | 7.75 MB | 3.5 MB |
| 页面滚动高度 | 11901 px | 820 px（视口内） |
| 带 transition 的元素 | 290 | <40 |

根因三条：

1. **封面全部 eager 加载**。每张都是 640×914 的 base64 内联图（单张约 17KB，合计 2.2MB），
   135 张同时解码，主线程被占满。
2. **无虚拟化**。`series-grid` 用 `auto-fill` 一次性渲染全部条目，DOM 规模随数据量线性增长。
3. **无请求治理**。一次页面加载实测打出 **41 次 `search_novelfm`** —— 搜索框与各榜单的
   "快读查找"共享输入状态，每次输入都触发一轮查询。

### P1 — 导航语义重复（"不方便"的根因）

原版侧栏 8 个平级入口：

```
发现 | 排行榜 | 探索 | 收藏 | 历史 | 离线 | 账号 | 设置
```

问题：

- **"找剧"被拆成 3 个入口**（发现 / 排行榜 / 探索），语义重叠，用户不知道该点哪个。
- **顶栏同时有"找剧 / 真人剧 / 漫剧"三个 tab**，与侧栏再次重叠。
- **收藏页内部还有 4 个子 tab**（桌面收藏 / 桌面历史 / 手机片单 / 离线文件），
  形成「两级侧栏 + 三级 tab」嵌套，极易迷路。
- **榜单页首屏 9 个交互元素互相竞争**：3 个榜单胶囊 + 4 个体裁胶囊 + 快速查找输入框 + 刷新按钮。

### P2 — 反馈不足

- 播放源解析慢时是空白等待，没有"解析中 / 失败可重试"的状态。
- 切集要关掉整个详情弹层再重新打开，浏览连续性被打断。
- 设置页把「老板键、原生验收回执、缓存预算」等内部术语直接暴露给用户。

---

## 3. 重构方案

### 3.1 信息架构（第一步的重排）

```
一级导航（4 项，高频）        二级（收进「更多」，低频）
├─ 首页                      ├─ 排行榜
├─ 搜索                      ├─ 探索片库
├─ 收藏                      ├─ 离线
└─ 我的（历史/账号）          ├─ 账号
                             └─ 设置
```

改动要点：

| # | 原版 | 重构后 | 理由 |
|---|---|---|---|
| 1 | 侧栏 8 项平铺 | 4 项一级 + 5 项收进「更多」 | 按频次分层，低频功能不占首屏注意力 |
| 2 | 顶栏「找剧/真人剧/漫剧」与侧栏重叠 | 顶栏只留**剧场模式切换**（真人/漫剧/AI） | 消除双重导航，剧场模式是全局开关而非页面 |
| 3 | 收藏页 4 个子 tab | 收纳进「我的」，横向分段控件 | 一屏可见全部，切换不改变布局上下文 |
| 4 | 首页三段并列大杂烩 | **继续观看 → 今日上新 → 猜你喜欢**，明确优先级 | 首页只服务一个目标：尽快开始看片 |
| 5 | 榜单页 9 个控件平铺 | 榜单切换 / 题材筛选 / 搜索 三层分离 | 每个控件职责单一 |
| 6 | 探索页 20+ 筛选 chip 平铺 | 收进「筛选」抽屉，已选项以可撤销 chip 显示 | 条件可见、可撤销、可一键清空 |
| 7 | 详情为居中 modal | 右侧抽屉 | 列表保持可见可滚动，随时关闭 |

### 3.2 渲染治理（第二步的优化）

| 手段 | 实现 | 位置 |
|---|---|---|
| 封面懒加载 | `IntersectionObserver` + `rootMargin: 300px`，进视口才挂 src | `components/SmartCover.jsx` |
| 占位与防抖 | 极小 SVG 占位 → `requestIdleCallback` 空闲时替换为真实代理 URL | `components/CoverProxy.jsx` |
| 渐进解码 | `decoding="async"` + 淡入过渡，消除白屏跳动 | `components/SmartCover.jsx` |
| 布局稳定 | `aspect-ratio` 预留封面尺寸，CLS = 0 | `components/SmartCover.jsx` |
| 网格虚拟化 | 按行窗口化，DOM 规模 O(可见行数) | `components/VirtualGrid.jsx` |
| 请求去重 | 同 key 并发请求复用同一 Promise | `lib/ipc.js` `dedupe()` |
| 并发闸门 | 全局并发上限 6，超出排队 | `lib/ipc.js` `Gate` |
| 超时控制 | 默认 20s，可按命令覆盖 | `lib/ipc.js` `withTimeout()` |
| 搜索防抖 | 260ms + 回车立即提交 | `components/SearchBox.jsx` |
| 骨架屏 | 内容未到时占位，不留白屏 | `views/DiscoverView.jsx` |

### 3.3 视觉与可访问性

- **统一设计 token**：颜色 / 间距 / 圆角 / 阴影全部收敛为 CSS 变量，
  消除原版 268 条规则中散落的硬编码阴影与模糊。
- **焦点可见**：`:focus-visible` 2px 主色描边，键盘可完整操作。
- **动效降级**：`prefers-reduced-motion` 下关闭 shimmer 与过渡。
- **对比度**：正文 `#f2f4f8` on `#0f1115`，次级文字满足 WCAG AA。

### 3.4 播放页重构

原版：播放器嵌在详情 modal 内 → 切集需关弹层。

重构：独立全屏播放页，左侧剧集列表常驻，右侧播放器 + 倍速/静音/上下一集。
解析状态显式区分 `resolving / ready / error`，失败给「重试 + 上一集」。

---

## 4. 产物对比

| 指标 | 原版 | 重构版 | 变化 |
|---|---|---|---|
| CSS | 78 KB | 19.05 KB（gzip 4.51 KB） | **-76%** |
| 业务 JS | 1,064,022 B | 41,490 B（gzip 14.39 KB） | **-96%** |
| React runtime | 混在主包 | 独立 chunk 140.86 KB（gzip 45.26 KB） | 可缓存复用 |
| DOM 节点 | 2102 | ~990 | **-53%** |
| 堆内存 | 7.75 MB | 3.5 MB | **-55%** |
| eager 图片 | 135 | 0 | 全部改懒加载 |
| 源码可维护性 | 1 个 1.06MB 压缩产物 | 17 个源文件 | 可读可改可测 |

测试：`tests/ui.test.jsx` 17 项全绿（请求去重 / 并发闸门 / 懒加载 / 防抖 / 导航结构 / 抽屉交互）。

---

## 5. 目录结构

```
D:\IDEA\hongguo-destop\
├─ app\
│  ├─ backend\              # 原版 Python 后端（完整可读源码，21 个 .py）
│  └─ frontend\             # 逆向还原的原版前端产物（基线，勿改）
│     ├─ index.html  index.js  index.css
│  └─ frontend-src\         # ★ 重构后的可维护源码工程
│     ├─ src\lib\ipc.js                 # 命令通道 + 请求治理
│     ├─ src\components\                # SmartCover / VirtualGrid / SearchBox / AppShell …
│     ├─ src\views\                     # Discover / Search / Rank / Explore / Mine / Settings / Player
│     ├─ src\styles\app.css             # 设计系统
│     └─ tests\ui.test.jsx              # 17 项回归测试
├─ shots\                   # 原版界面截图（改造基线）
├─ shots-new\               # 重构后界面截图
└─ rea-out\                 # REA 逆向证据（artifact.json / 资源提取 / 运行时探测）
```

---

## 6. 本地运行

```bash
# 1) 后端（复用原版 Python 运行时）
cd "D:\红果免费短剧\backend"
API_KEYS=local-dev-key HONGGUO_CONTENT_CONFIG=<data>/content-config.json \
  python/python.exe -c "import uvicorn,server; uvicorn.run(server.app,host='127.0.0.1',port=8100)"

# 2) 前端
cd app/frontend-src
npm install
npm run dev        # http://127.0.0.1:1420  (/api 已代理到后端)
npm run build      # 产物 dist/，供 Tauri frontendDist 使用
npm test           # vitest
```

---

## 7. 后续建议

1. **打包回 exe**：把 `app/frontend-src/dist` 接入 `src-tauri/tauri.conf.json` 的
   `frontendDist`，重新 `tauri build`。当前 exe 的 Rust 侧源码不在本机，
   需从上游仓库 `hongguo-desktop-releases` 取回 `src/` 目录。
2. **补齐 Rust 命令**：把 `get_rank` / `search_novelfm` 等数据命令加入
   Tauri capabilities ACL，或统一改为 HTTP 代理（推荐后者，与原版一致）。
3. **播放链路验证**：`get_desktop_playback` 的解密与 HLS 转封装尚未在新 UI 中联调，
   需要签名服务（unidbg）就绪后验证。
4. **埋点**：建议补上首屏耗时、封面加载成功率、播放起播耗时三个指标，
   用于持续监控卡顿是否真正解决。

---

## 8. 增量需求：小窗播放 / 播放中推荐 / 上下滑动切换

> 追加于 2026-10-24 第二轮迭代

### 8.1 需求拆解

用户诉求原文：「小窗播放，播放的时候不影响我找其他的。可以有推荐，播放第一集上下滑动切换，
点击可以进去看更多。」

拆成三个可交付能力：

| # | 能力 | 验收标准 |
|---|---|---|
| A | 小窗播放 | 播放中可收起为悬浮小窗，主界面照常浏览，视频不中断、不重新加载 |
| B | 播放中推荐 | 播放页常驻推荐位，内容随当前剧动态更新 |
| C | 上下滑动切换 | 推荐列表支持滚轮/触控上下滑动逐张切换，点击进入详情 |

### 8.2 关键设计：单 `<video>` 实例

A 的难点在于「不中断」。如果小窗和大窗各放一个 `<video>`，切换时必然重建元素，
导致重新缓冲、进度丢失。

**做法**：整个应用只存在一个 `<video>` 元素，通过 React portal 在
「全屏播放页」与「悬浮小窗」两个容器之间**移动** DOM 节点。
节点被移动而非销毁重建，因此播放进度、缓冲、暂停状态全部保留。

代码位置：
- `src/lib/playback-context.jsx` —— 全局播放会话（剧目/集号/src/进度/倍速/静音）
- `src/components/VideoSurface.jsx` —— 唯一的 `<video>`，负责播放状态与快捷键
- `src/components/MiniPlayer.jsx` —— 悬浮窗（portal 承载 VideoSurface）

```
播放会话状态（PlaybackProvider）
   │  current / ep / src / status / episodes / position / rate / muted
   ▼
VideoSurface  ── 唯一的 <video> 元素
   │  ▲
   │  └── portal 移动（不重建）
   ▼
PlayerView（全屏）  ⇄  MiniPlayer（悬浮小窗）
```

### 8.3 小窗交互

| 操作 | 结果 |
|---|---|
| 拖动标题栏 | 移动窗口，位置持久化到 localStorage |
| 双击标题栏 | 折叠 / 展开小窗（折叠后只留标题条） |
| `▣` 按钮 | 收起小窗，回到全屏播放页 |
| `⤢` 按钮 | 从小窗展开回全屏 |
| `×` 按钮 | 关闭播放 |
| 悬停播放器 | 显示剧名、集数、上一集/下一集快捷条 |

窗口位置在窗口尺寸变化时自动回拉到可视区内，避免小窗跑到屏幕外找不到。

### 8.4 竖向滑动推荐（C）

`src/components/SwipeRecommend.jsx`

- **滚轮接管**：`onWheel` 用 `passive: false` + `preventDefault`，
  一次滚轮切一张。不接管的话滚轮会连带滚动整页，破坏沉浸感。
  420ms 锁避免触控板惯性滚动时连续跳过多张。
- **触控滑动**：`scroll-snap-type: y mandatory` + `scroll-snap-align: start`，
  滑到一半自动吸附到整张。
- **键盘**：↑↓ / ←→ 逐项移动。
- **点击**：打开详情抽屉（「进去看更多」）；双击直接换台播放。
- **视觉反馈**：当前项高亮放大（opacity 0.5→1、scale 0.97→1），
  右侧竖排指示点标记当前位置。

### 8.5 推荐数据源

`src/lib/playback.js` 的 `fetchRecommendations()`：
并发取「热播榜」+「最新上架」，合并去重并排除当前剧，取前 12 条。
任一来源失败不影响另一个（`Promise.allSettled`）。

### 8.6 过程中发现并修复的真实缺陷

这一轮联调暴露了两个会导致**整页白屏**的严重缺陷，值得单独记录：

**缺陷 1：上游 episodes 结构抖动**
`/episodes` 返回的 `episodes` 在某些路径下是对象而非数组，
`episodes.filter(...)` 直接抛错，React 卸载整棵树 —— 所有页面都进不去。

修复：
- `normalizeEpisodes()` 统一归一化，数组/对象/错误响应都能安全处理；
- 所有视图的 `setItems/setResults/setFavorites` 一律用 `Array.isArray()` 兜底；
- 新增 `ErrorBoundary`，把故障范围限制在单个视图内（播放页挂了首页照常可用）。

**缺陷 2：localStorage 被污染后 `.filter` 崩溃**
浏览器模式下收藏/历史存在 localStorage，若被写入非数组内容，
读取后 `.filter` 同样会抛错。

修复：`localStore.readList()` 强制返回数组，`read()` 检测到类型不符即降级。

### 8.7 验证

`tests/playback.test.jsx` 新增 14 项（归一化、localStorage 防御、错误边界、滑动列表），
连同原有 17 项共 **31 项全绿**。

真实环境验证（`tools/verify_new_features.py`，走 WebView2 CDP）：

```
PLAYER STATE:  video=true  epRows=1000  swipeItems=12
MINI STATE:    miniExists=true  miniVideo=true  mainNavVisible=true
BROWSE STATE:  miniStillThere=true  cards=60   ← 切到排行榜，小窗仍在
SWIPE:         swipeItems=12  listH=320
```

### 8.8 已知限制：视频源上游被拒

播放链路本身已打通（`/episodes` → 1000 集正常，`/stream?vid=` 已构造正确 URL），
但实测红果上游的 `multi_video_model` 接口返回 **HTTP 200 + 空 body**，
导致拿不到视频直链，播放器停在缓冲态。

**这与本次重构无关**：原版的 `get_desktop_playback` 走的是同一个后端接口，
同样会失败。已验证签名服务本身健康（`/sign` 正常返回 `X-Neptune` 头），
问题出在红果对该接口的风控。

后续处理方向：
1. 观察是否随时间恢复（上游风控可能是临时的）；
2. 若持续失败，检查 `guest-config.json` 的 `version_code` / `device_platform`
   是否已落后于红果当前版本；
3. 原版的 Frida 兜底路径（`backend/frida/`）在 `SIGN_SERVER` 不可用时会启用，
   可作为替代签名通道，但需要一台真实安卓设备。

---

## 9. 覆盖安装：把重构版装进 exe

### 9.1 Tauri v2 资源存储格式（逆向结论）

Tauri v2 用 `tauri-codegen` 把前端产物编译进 exe 的 `.rdata` 段，形式是
`phf::Map<&'static str, (&'static [u8], AssetKey)>`。

每个 phf entry 在 `.rdata` 里是 4 个连续 u64：

```
(key_ptr, key_len, value_ptr, value_len)
```

- `key_ptr` → 资源路径字符串（如 `/assets/index-CTpIsaLU.js`）
- `value_ptr` → **brotli 压缩后**的内容
- `value_len` → 压缩后长度

实测：`/assets/index-BrrRYD-G.css` 槽位 14304 字节 → 解压出 77569 字节，与原 CSS 文件完全一致。

工具：
- `tools/tauri_assets.py` —— 解析资源表、列出所有资源
- `tools/inject_frontend.py` —— 注入新资源

### 9.2 替换策略

新资源 brotli 压缩后若 **≤ 原槽位**：原地覆盖 + 尾部补零，段布局完全不动（最安全）。
若 **> 原槽位**：追加到 `.rdata` 段末尾之后并扩大该段的 raw/virtual size，
更新 entry 的 `value_ptr`/`value_len`。因为是文件尾部追加，所有已有 RVA 不变，无需重排段表。

本项目的实际压缩体积：

| 资源 | 原槽位 | 新压缩后 | 明文 |
|---|---|---|---|
| index.html | 247 B | 217 B | 555 B |
| index.css | 14304 B | 5026 B | 25.99 KB |
| index.js | 304379 B | 56397 B | 200.44 KB |

三处都是原地覆盖，**exe 体积不变，段布局零改动**。

### 9.3 一个必须解决的前提

Tauri 的资源 key 是**编译期固定**的（`/assets/index-CTpIsaLU.js`），
而 Vite 产物文件名带内容 hash（`index-BNdfOjmw.js`）。两者对不上就会 404 白屏。

两个处理：
1. **Vite 关闭分块**（`manualChunks: undefined` + `inlineDynamicImports: true`），
   保证产物只有「一个 CSS + 一个 JS」，与原版结构一致。
   多 chunk 需要往资源表注入新 key，而 key 字符串池编译期生成，改不了。
2. **注入时改写 HTML 引用**，把 `/assets/index.js` 替换成 `/assets/index-CTpIsaLU.js`。

### 9.4 安装位置与回滚

```
D:\红果免费短剧\
  ├─ hongguo-desktop-companion.exe        ← 已注入新前端
  ├─ hongguo-desktop-companion.exe.orig   ← 自动备份
  └─ _backup-1.0.19\
       └─ hongguo-desktop-companion.exe.orig  ← 手动备份
```

回滚：把备份文件复制回 `hongguo-desktop-companion.exe` 即可。

### 9.5 两条数据通道的字段差异

打包进 exe 后，数据全部走 Tauri IPC，字段名与 Python HTTP 完全不同：

| 语义 | IPC（Tauri） | HTTP（后端） |
|---|---|---|
| 剧目 id | `seriesId` | `series_id` |
| 集数 | `episodeCount` | `episode_cnt` |
| 热度 | `hotText`（"6981万热度"） | `play_cnt`（数字） |
| 封面 | `guoban-cover:<id>` 占位协议 | 真实 https URL |
| 选集 | `episodes: [1,2,3...]`（集号数组） | `episodes: [{index,vid,...}]` |

用 `src/lib/normalize.js` 统一成一套内部结构（`id` / `title` / `cover` / `episodes` / `hot`），
上层组件不再关心数据来源。

**封面占位协议** `guoban-cover:<id>` 不是合法 URL，
必须调 `get_series_cover` 换成 `data:image/jpeg;base64,...`。
由 `src/lib/useResolvedCover.js` 统一处理（卡片 / 推荐列表 / 详情抽屉三处复用）。

### 9.6 已知限制
- `get_desktop_playback`（桌面账号播放）需要 `HONGGUO_DESKTOP_AUTH_*` 配置，
  未配置时 Rust 侧直接抛错；游客态应走 `get_validation_playback`（HLS 流），这条已通。
- 扫码登录（`desktop_qr_*`）同样依赖上述配置，
  实测 `get_desktop_auth_status` 返回 `configured: false`，所以 UI 不提供该入口。

---

## 10. 第四轮：窗口拖动 + 首页卡片撑破

### 10.1 窗口拖不动

**现象**：应用窗口无法拖动位置。

**根因**：重构版完全没有实现窗口拖动。原版的做法是在顶栏等处标
`data-tauri-drag-region="deep"`，依赖 Tauri 内置的初始化脚本扫描 DOM 并绑定事件。
但本项目的前端是**运行时注入**进 exe 的（资源直接写进 .rdata），
这段初始化脚本不一定覆盖到后来渲染的节点 —— 实测点击顶栏空白处不触发 `start_dragging`。

**解决**：自己实现拖动，`src/lib/window-drag.js`。

```
mousedown / pointerdown  (capture 阶段)
   ↓
落在 [data-window-drag="false"] 里？ → 放弃
落在 [data-window-drag] 之外？    → 放弃
目标是 button/a/input/…         → 放弃
   ↓
e.preventDefault()
invoke('plugin:window|start_dragging')
```

**三个关键约束（都踩过坑）**：

1. **必须用 capture 阶段监听**。
   Tauri 内置的 drag-region 脚本也在 capture 阶段处理 pointerdown，
   挂在冒泡阶段就永远收不到事件。
2. **`invoke` 属性是只读的**（`writable: false, configurable: false`），
   所以 `window.__TAURI_INTERNALS__.invoke = spy` 这种探针**根本替换不掉**，
   调试时不能靠它判断调用是否发生，要改用 `preventDefault` 副作用来判定。
3. **CDP 合成鼠标事件不驱动 OS 级窗口拖动循环**，
   `Input.dispatchMouseEvent` 无法验证窗口真的移动了。
   验证方式只能是「hook 是否执行」+「命令是否可用」两条间接证据。

**拖动区布局**：

| 区域 | 可拖动 | 说明 |
|---|---|---|
| 顶栏空白处 | ✅ | 鼠标显示 grab |
| 侧栏品牌区 | ✅ | |
| 剧场模式切换 | ❌ | 按钮区，避免误触 |
| 搜索框 | ❌ | 需要能选中文本 |
| 播放页顶栏 | ✅ | 返回键/小窗按钮除外 |
| 详情抽屉标题区 | ✅ | 操作按钮除外 |

### 10.2 首页「继续观看」卡片撑成巨大色块

**现象**：只有一条观看历史时，「继续观看」区块里那张卡片占满整行，
变成一个巨大的空色块。

**根因**：`.rail-cards` 用了
`grid-auto-flow: column; grid-auto-columns: minmax(150px, 1fr)`。
`1fr` 在只有 1 个 grid item 时会吃掉全部可用宽度。

**解决**：改成固定宽度 `grid-auto-columns: 168px`，轨道横向滚动，卡片尺寸恒定。

### 10.3 历史记录信息不全

**现象**：历史记录里第一张卡片标题是占位文案「查看剧集」、封面空白。

**根因**：Rust 侧的本地历史只存了 id + 集数，
`title` 是占位文案、`cover` 是空串、`episodes` 字段名也不同（`episodeCount` / `lastEpisode`）。

**解决**：
1. `normalize.js` 补齐字段映射，新增 `lastEpisode` / `coverMissing`；
2. `listHistory()` 对缺 title 或缺 cover 的条目调 `get_series` 补全；
3. 封面加载失败时用按剧名生成的渐变占位图（320×457 SVG，仅几百字节），
   而不是刺眼的「无封面」文字。

实测：标题从「查看剧集」补全为「爆笑大唐：李世民又来蹭饭了」，
封面从空白变为真实图片（720×1008）。

### 10.4 顺带修掉的模块循环依赖

`ipc.js` 的 `import` 语句写在文件**中部**（第 335 行），
且 `playback.js` ↔ `ipc.js` 互相引用。
已把 import 提到文件顶部，并消除 `playback.js` 里的动态 `await import('./ipc.js')`。

---

## 11. 第五轮：收藏报错（IPC 参数契约错误）

### 11.1 现象

点收藏按钮弹出红色错误：
```
收藏操作失败: invalid args `series` for command `set_favorite`:
command set_favorite required key series
```

### 11.2 根因：写命令的参数名写错了

把原版前端产物里所有 `Ke("cmd", {args})` 调用全部提取出来，得到权威契约表：

| 命令 | 正确参数 | 写错的版本 |
|---|---|---|
| `set_favorite` | `{ series, favorite }` | `{ seriesId, favorite }` ❌ |
| `add_history` | `{ series, lastEpisode }` | `{ seriesId, ep }` ❌ |
| `remove_history` | `{ seriesIds }` | `{ seriesIds }` ✓ |

注意 `set_favorite` / `add_history` 的 `series` 收的是**整个剧目对象**（不是 id），
字段名必须与 Rust 侧的 serde 定义完全一致。

Rust 侧的 `SeriesSummary` 结构（从 exe 的字段表逆向得到）：

```
seriesId, title, cover, intro, actors, tags,
episodeCount, webAccessibleEpisodes, hotText, source
```

### 11.3 修复

新增 `toSeriesSummary()`（`src/lib/normalize.js`），
把内部归一化结构转成 Rust 侧 SeriesSummary 的精确字段形状：

```js
{
  seriesId, title, cover, intro, actors, tags,
  episodeCount, webAccessibleEpisodes, hotText, source
}
```

写命令统一走它：

```js
callOnce('set_favorite', { series: toSeriesSummary(series), favorite })
callOnce('add_history', { series: toSeriesSummary(series), lastEpisode: ep })
```

### 11.4 顺带修掉：写命令返回值不能用来刷新 UI

`set_favorite` 返回的是**布尔值**（是否成功），不是列表。
原实现 `setFavorites(Array.isArray(next) ? next : favorites)`
走了 fallback 分支 → 后端存成功了，但界面星标不变。

改为：写命令后**重新拉一次列表**来刷新状态。

```js
await setFavorite(item, !isFav)
const list = await listFavorites()
setFavorites(Array.isArray(list) ? list : favorites)
```

`remove_history` 同样处理。

### 11.5 验证

新增 `tests/ipc-contract.test.jsx`（6 项）锁定参数契约与 SeriesSummary 字段名，
连同原有用例共 **43 项全绿**。

真实环境端到端验证：

```
初始状态: 未收藏
点击后 toast: 已加入收藏
点击后状态: 已收藏
收藏页卡片数: 1
收藏页标题: ["和离后我带女儿横扫魔域"]
后端收藏: count=1
```

用真实榜单数据（cover 为 `guoban-cover:` 协议）验证，封面正确解析为 400×572 真实图片。
