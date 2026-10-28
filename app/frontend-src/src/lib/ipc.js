import {
  extractCellItems,
  extractSeriesList,
  normalizeEpisodes,
  normalizeSeries,
  normalizeSeriesList,
} from './normalize.js'

/**
 * 数据访问层
 *
 * 自建 Tauri 壳之后不再迁就厂商 exe 的 ACL 与 CSP，通道收敛成一条：
 *
 *   组件 -> call(command, args) -> 路由表 API_ROUTES -> 传输层
 *
 * 路由表只有一份，传输层按环境选择：
 *   - Tauri：invoke('upstream_get' | 'upstream_post')，由 Rust 注入游客态设备参数
 *     与 okhttp UA，前端不碰上游协议细节。
 *   - 浏览器（vite dev/preview）：走 /upstream 同源反代，不打包也能调真实数据。
 *
 * 不再依赖本机 Python 后端：实测（2026-10-27）榜单类接口免签可直连，
 * 而搜索/剧集详情/播放地址必须带 X-Argus 签名，签名服务缺失即路由为 blocked，
 * 由界面显示明确原因。
 *
 * 额外能力：
 *  1. 请求治理：统一的去重、超时与并发闸门，避免原版
 *     "135 张封面同时 eager 加载 + 41 次 search_novelfm" 造成的卡顿。
 *  2. 本地状态（收藏/历史）在 Tauri 下落盘到应用数据目录，
 *     浏览器模式回落 localStorage，两者读写路径同构。
 */

const TAURI_INTERNALS = '__TAURI_INTERNALS__'

export const isTauri = () =>
  typeof window !== 'undefined' && Boolean(window[TAURI_INTERNALS])

/* ------------------------------------------------------------------ */
/* 并发闸门                                                           */
/* ------------------------------------------------------------------ */

/**
 * 原版问题：进入「发现」页会并发打出 8 次 search_novelfm + 12 次 get_series_cover，
 * 全部抢同一个渲染线程。这里给所有 IPC 调用加一个全局并发上限，
 * 超出的请求排队而不是并发，避免主线程被回调淹没。
 */
class Gate {
  constructor(limit = 6) {
    this.limit = limit
    this.active = 0
    this.queue = []
  }

  async run(fn) {
    if (this.active >= this.limit) {
      await new Promise((resolve) => this.queue.push(resolve))
    }
    this.active += 1
    try {
      return await fn()
    } finally {
      this.active -= 1
      const next = this.queue.shift()
      if (next) next()
    }
  }
}

const gate = new Gate(6)

/* ------------------------------------------------------------------ */
/* 在途请求去重                                                       */
/* ------------------------------------------------------------------ */

const inFlight = new Map()

/**
 * 同一 key 的并发请求复用同一个 Promise。
 * 原版重复触发 search_novelfm 时会真正打多次上游请求，这里做收敛。
 */
function dedupe(key, factory) {
  if (!key) return factory()
  if (inFlight.has(key)) return inFlight.get(key)
  const promise = gate.run(factory).finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}

/* ------------------------------------------------------------------ */
/* 超时                                                                */
/* ------------------------------------------------------------------ */

const DEFAULT_TIMEOUT = 20000

function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时`)), ms)
    }),
  ])
}

/* ------------------------------------------------------------------ */
/* Tauri 侧调用                                                       */
/* ------------------------------------------------------------------ */

async function tauriInvoke(command, args) {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args ?? {})
}

/* ------------------------------------------------------------------ */
/* 路由表：command -> 数据源（两种传输共用一份定义）                    */
/* ------------------------------------------------------------------ */

/**
 * 三类数据源：
 *   upstream -> 直连红果上游，由 Rust 注入游客态设备参数（免签可用的接口）
 *   blocked  -> 上游实测必须带 X-Argus 签名，签名服务（unidbg-sign.jar）已不在本机，
 *               明确报出原因，不伪装成网络故障
 *   local    -> 本机状态（收藏/历史），不出网
 *   stub     -> 上游没有对应能力时的稳定占位，避免 UI 因为缺功能而崩
 */
const RANK_UPSTREAM_PATH = '/reading/bookapi/bookmall/cell/change/v'
const RANK_CELL_ID = '7470092475068071998'

/**
 * 剧场模式 -> 榜单接口参数。
 * selected_items 是「哪个剧场」，sub_selected_items 是「哪个榜」，
 * 两组 id 来自上游 cell_selector 实测（2026-10-27，7.4.1.32 游客态免签返回 code=0；
 * 2026-10-28 用 7.4.3.17 复测同样是 code=0）。
 */
const THEATERS = {
  short_play: {
    selected: 'human',
    boards: {
      recommend: 'human_hot_sc',
      hot: 'human_hot_play',
      new: 'human_new_rank',
      hotSearch: 'human_hot_search',
      mustWatch: 'human_must_watch',
      followed: 'human_followed',
    },
  },
  comic_series: {
    selected: 'comic_series_rank',
    boards: {
      recommend: 'comic_series_hot_rank',
      hot: 'comic_series_hot_play',
      new: 'comic_series_new_rank',
      hotSearch: 'comic_series_hot_search',
    },
  },
  ai_series: {
    selected: 'ai_playlet',
    boards: {
      recommend: 'ai_playlet_hot_sc',
      hot: 'ai_playlet_hot_play',
      new: 'ai_playlet_new_rank',
      hotSearch: 'ai_playlet_hot_search',
      mustWatch: 'ai_playlet_must_watch',
      followed: 'ai_playlet_followed',
    },
  },
}

const SIGNATURE_REQUIRED = '该接口需要 X-Argus 签名，本机签名服务缺失（unidbg-sign.jar 已丢失），暂时不可用'

/** 榜单请求：按剧场+榜别拼上游参数，limit 交给分页器累计。 */
function rankRoute(genre, board, limit) {
  const theater = THEATERS[genre] ?? THEATERS.short_play
  const sub = theater.boards[board] ?? theater.boards.hot
  return {
    upstream: {
      method: 'GET',
      path: RANK_UPSTREAM_PATH,
      query: {
        cell_id: RANK_CELL_ID,
        tab_type: '26',
        client_req_type: '2',
        client_template: '2',
        screen_width_px: '1350',
        selected_items: theater.selected,
        sub_selected_items: sub,
        session_uuid: newUuid(),
      },
    },
    limit,
  }
}

function newUuid() {
  return globalThis.crypto?.randomUUID?.() ??
    `hg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const API_ROUTES = {
  get_rank: (a) => rankRoute(a?.genre ?? a?.mode, a?.rankType, a?.limit ?? 60),
  get_recommendations: (a) => rankRoute(a?.genre, 'recommend', a?.limit ?? 40),
  get_new_releases: (a) => rankRoute(a?.genre, 'new', a?.limit ?? 40),
  search_explorer: (a) => rankRoute(a?.genre, 'hot', a?.limit ?? 60),
  // 以下接口免签实测一律 HTTP 200 + 空 body（见 tools/upstream_probe.mjs）。
  search_novelfm: () => ({ blocked: SIGNATURE_REQUIRED }),
  get_series: () => ({ blocked: SIGNATURE_REQUIRED }),
  get_validation_episodes: () => ({ blocked: SIGNATURE_REQUIRED }),
  get_validation_playback: () => ({ blocked: SIGNATURE_REQUIRED }),
  get_category: () => ({ blocked: SIGNATURE_REQUIRED }),
  get_category_options: () => ({ blocked: SIGNATURE_REQUIRED }),
  get_taste_tags: () => ({ blocked: SIGNATURE_REQUIRED }),
  // 手机号登录：发码/校验/会话都是账号服务的 HTTP 调用，
  // 签名（X-Gorgon / X-Helios / X-Ladon / Medusa）由本机 Python 账号宿主完成。
  phone_account_status: () => ({ account: { action: 'status' } }),
  phone_account_send_code: (a) => ({ account: { action: 'send', phone: a?.phone } }),
  phone_account_login: (a) => ({ account: { action: 'login', phone: a?.phone, code: a?.code } }),
  phone_account_continue: () => ({ account: { action: 'continue' } }),
  phone_account_logout: () => ({ account: { action: 'logout' } }),
  list_favorites: () => ({ local: 'favorites' }),
  list_history: () => ({ local: 'history' }),
  get_update_status: () => ({ stub: { has_update: false } }),
  check_app_update: () => ({ stub: { has_update: false } }),
  get_diagnostic_summary: () => ({ stub: {} }),
  list_devices: () => ({ stub: [] }),
  get_boss_playback_state: () => ({ stub: { enabled: false } }),
}

/* ------------------------------------------------------------------ */
/* 传输层                                                             */
/* ------------------------------------------------------------------ */

/** 上游一页约 10 条，翻页上限按 limit 收敛，避免一次刷爆上游。 */
const MAX_UPSTREAM_PAGES = 6

/** Tauri：上游请求交给我方 Rust，设备参数与 UA 都在进程内拼装。 */
async function transportTauri(route) {
  const u = route.upstream
  if (u.method === 'POST') {
    return tauriInvoke('upstream_post', { path: u.path, query: u.query ?? {}, body: u.body ?? {} })
  }
  return tauriInvoke('upstream_get', { path: u.path, query: u.query ?? {} })
}

/** 浏览器：vite 把 /upstream 反代到同一个主机，保证 dev/preview 也能看真实数据。 */
async function transportHttp(route) {
  const u = route.upstream
  const url = new URL(`/upstream${u.path}`, window.location.origin)
  for (const [k, v] of Object.entries(u.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString(), {
    ...(u.method === 'POST'
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify(u.body ?? {}),
        }
      : {}),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  })
  if (!res.ok) throw new Error(`${u.path} -> ${res.status}`)
  const text = await res.text()
  if (!text.trim()) throw new Error(SIGNATURE_REQUIRED)
  return JSON.parse(text)
}

/**
 * 上游请求 + 榜单分页。
 * 返回 { items } 形态，交给 extractSeriesList 与后端历史形态走同一条归一化路径。
 */
async function requestUpstream(route) {
  const send = isTauri() ? transportTauri : transportHttp
  const first = await send(route)
  if (!route.limit) return first

  const items = extractCellItems(first)
  let payload = first
  for (let page = 1; page < MAX_UPSTREAM_PAGES; page += 1) {
    const view = payload?.data?.cell_view
    if (items.length >= route.limit || !view?.has_more) break
    payload = await send({
      ...route,
      upstream: {
        ...route.upstream,
        query: { ...route.upstream.query, offset: String(view.next_offset ?? items.length) },
      },
    })
    const more = extractCellItems(payload)
    if (!more.length) break
    items.push(...more)
  }
  return { items: items.slice(0, route.limit) }
}

/* ------------------------------------------------------------------ */
/* 公共入口                                                           */
/* ------------------------------------------------------------------ */

/**
 * 命令 -> 路由。导出以便契约测试直接断言，不必伪造一整条调用链。
 * @throws 路由表里没有的命令
 */
export function resolveRoute(command, args) {
  const route = API_ROUTES[command]
  if (!route) throw new Error(`未知命令 ${command}`)
  return route(args ?? {})
}

/**
 * 决定一次调用的执行通道。
 *
 * 规则（自建壳之后只有一条，不再区分"原版 ACL 允不允许"）：
 *   stub -> 直接返回占位；local -> 本机状态库；其余 -> 后端（按环境选传输）。
 */
async function dispatch(command, args) {
  const resolved = resolveRoute(command, args)
  if (resolved.stub !== undefined) return resolved.stub
  if (resolved.local) return kv.readList(resolved.local)
  if (resolved.blocked) throw new Error(resolved.blocked)
  if (resolved.account) {
    if (!isTauri()) throw new Error('账号登录只在桌面端可用')
    return tauriInvoke('phone_account_call', resolved.account)
  }
  return requestUpstream(resolved)
}

/**
 * 调用一个后端命令。
 * @param {string} command 命令名，与原版 Rust command 完全一致
 * @param {object} args 参数
 * @param {{key?: string, timeout?: number}} options 治理选项
 */
export function call(command, args, options = {}) {
  const key = options.key ?? `${command}:${JSON.stringify(args ?? {})}`
  return dedupe(key, () => {
    const run = dispatch(command, args)
    return withTimeout(run, options.timeout ?? DEFAULT_TIMEOUT, command)
  })
}

/** 不做去重的调用（写操作必须独立触发）。 */
export function callOnce(command, args, options = {}) {
  const run = dispatch(command, args)
  return withTimeout(run, options.timeout ?? DEFAULT_TIMEOUT, command)
}

/**
 * 对外的语义化数据接口。
 *
 * 内部两条通道的字段命名完全不同（IPC 用驼峰 seriesId，
 * HTTP 用下划线 series_id），这里统一成规范结构再交给上层，
 * 组件不必关心当前跑在 Tauri 还是浏览器。
 */

/** 拉取榜单。genre 为剧场模式（short_play/comic_series/ai_series），缺省按真人剧。 */
export async function fetchRank(rankType = 'hot', page = 1, genre = 'short_play') {
  const res = await call('get_rank', { rankType, page, genre })
  return normalizeSeriesList(extractSeriesList(res))
}

/** 拉取推荐（按口味标签）。 */
export async function fetchRecommendations(tasteTags = []) {
  const res = await call('get_recommendations', { tasteTags })
  return normalizeSeriesList(extractSeriesList(res))
}

/** 拉取最新上架。 */
export async function fetchNewReleases(genre = 'short_play') {
  const res = await call('get_new_releases', { genre, ranked: false })
  return normalizeSeriesList(extractSeriesList(res))
}

/**
 * 搜索。
 * IPC 通道的 mode 只接受 'short' | 'manju'，HTTP 通道没有这个参数。
 */
export async function searchSeries(query, mode = 'short', page = 1) {
  const res = await call('search_novelfm', { query, page, mode })
  return normalizeSeriesList(extractSeriesList(res))
}

/** 拉取某剧的详情与选集。 */
export async function fetchSeriesDetail(seriesId) {
  const res = await call('get_series', { seriesId })
  const meta = res?.meta ?? res
  const episodes = normalizeEpisodes(res)
  return {
    series: normalizeSeries(meta),
    episodes,
  }
}

/**
 * 解析封面。
 *
 * 上游给的是带 x-expires/x-signature 的 CDN 直链，实测任意 UA 都能直接取到
 * image/jpeg（2026-10-27），WebView2 里没有防盗链问题，因此不再经图片代理：
 * 少一跳、少一份内存拷贝，也不需要一个后端进程才能看图。
 */
export async function fetchCover(series) {
  const cover = series?.cover ?? ''
  // `guoban-cover:<id>` 是厂商 exe 的占位协议，自建链路不会出现，按缺图处理。
  return /^https?:\/\//i.test(cover) ? cover : ''
}

const LS_PREFIX = 'hongguo:'

export const localStore = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key)
      if (!raw) return fallback
      const parsed = JSON.parse(raw)
      // 防御：历史数据可能是对象而非数组，统一降级为 fallback，
      // 否则调用方的 .filter/.map 会直接抛错把整个视图打崩。
      if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback
      return parsed
    } catch {
      return fallback
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
    } catch {
      /* 配额满时静默降级，不阻塞 UI */
    }
  },
  /** 读取数组型数据，强制保证返回数组。 */
  readList(key) {
    const value = localStore.read(key, [])
    return Array.isArray(value) ? value : []
  },
}

/**
 * 本机状态读写。
 * Tauri 下落盘到应用数据目录的 state.json（Rust 侧原子写，不会留半截 JSON），
 * 浏览器模式回落 localStorage。
 */
export async function readState(key) {
  if (!isTauri()) return localStore.read(key, null)
  return tauriInvoke('store_read', { key: LS_PREFIX + key })
}

export async function writeState(key, value) {
  if (isTauri()) {
    await tauriInvoke('store_write', { key: LS_PREFIX + key, value })
    return value
  }
  localStore.write(key, value)
  return value
}

/**
 * 数组型本机状态（收藏 / 历史）。
 * 两条路径都强制返回数组，因为一次结构抖动就会让调用方的 .filter 抛错、
 * React 卸载整棵树。
 */
export const kv = {
  async readList(key) {
    const value = await readState(key)
    return Array.isArray(value) ? value : []
  },
  async writeList(key, value) {
    const list = Array.isArray(value) ? value : []
    return writeState(key, list)
  },
}

/**
 * 收藏与历史。
 *
 * 存的是归一化之后的完整对象，读出来即可渲染 —— 不再需要像厂商那样
 * 把整个 SeriesSummary 传给 Rust 反序列化（历史上这里踩过
 * "invalid args `series` for command `set_favorite`"）。
 * 写命令的返回值一律以本地计算出的新列表为准。
 */
export async function setFavorite(series, favorite) {
  const list = await kv.readList('favorites')
  const next = favorite
    ? [series, ...list.filter((x) => x?.id !== series.id)]
    : list.filter((x) => x?.id !== series.id)
  return kv.writeList('favorites', next)
}

export async function listFavorites() {
  return normalizeSeriesList(await kv.readList('favorites'))
}

export async function setHistory(series, ep) {
  const list = await kv.readList('history')
  const next = [{ ...series, ep, at: Date.now() }, ...list.filter((x) => x?.id !== series.id)]
  return kv.writeList('history', next.slice(0, 100))
}

export async function listHistory() {
  return normalizeSeriesList(await kv.readList('history'))
}

export async function removeHistory(seriesId) {
  const list = await kv.readList('history')
  return kv.writeList('history', list.filter((x) => x?.id !== seriesId))
}
