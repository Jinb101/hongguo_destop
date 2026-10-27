/**
 * 数据归一化层
 *
 * 上游（本机 Python 后端的 /rank /latest /browse /episodes）统一是下划线字段：
 *   { series_id, title, cover, intro, episode_cnt, play_cnt, copyright }
 * 但历史数据、缓存与个别接口仍可能给出驼峰形态
 * （{ seriesId, episodeCount, hotText }），来自原版的 IPC 通道。
 *
 * 本模块把两种形态统一成前端内部使用的规范结构，
 * 上层组件只认一套字段，不必关心数据来自哪次改版。
 */

/** 规范结构：{ id, title, cover, intro, episodes, hot, genres[], actors[] } */

export function normalizeSeries(raw) {
  if (!raw || typeof raw !== 'object') return null

  const id = raw.seriesId ?? raw.series_id ?? raw.id ?? ''
  if (!id) return null

  const title = raw.title ?? raw.name ?? '未命名'
  const episodes = Number(
    raw.episodeCount ?? raw.episode_cnt ?? raw.total_episode ?? raw.episode_count ?? 0,
  )

  // 热度：IPC 侧是文本 "6981万热度"，HTTP 侧是数字 play_cnt
  const hotRaw = raw.hotText ?? raw.hot_score ?? raw.play_cnt ?? raw.hot ?? ''
  const hot = typeof hotRaw === 'number' ? formatHot(hotRaw) : String(hotRaw || '')

  const genres = []
  if (Array.isArray(raw.tags)) genres.push(...raw.tags.filter(Boolean))
  if (raw.genre_name) genres.push(raw.genre_name)
  if (raw.copyright) genres.push(raw.copyright)

  const actors = Array.isArray(raw.actors) ? raw.actors.filter(Boolean) : []

  const cover = raw.cover ?? ''

  return {
    id: String(id),
    series_id: String(id),
    title,
    cover,
    // 封面可能是 guoban-cover:<id> 占位协议，需要 IPC 解析；
    // 也可能整个为空（历史记录里常见），此时不能当作占位协议处理。
    coverIsProxy: cover.startsWith('guoban-cover:'),
    coverMissing: !cover,
    intro: raw.intro ?? raw.description ?? '',
    episodes,
    episodeCount: episodes,
    accessibleEpisodes: Number(raw.webAccessibleEpisodes ?? 0),
    // 历史记录里存的是「上次看到第几集」
    lastEpisode: Number(raw.lastEpisode ?? raw.ep ?? raw.episode ?? 0),
    hot,
    genres,
    actors,
    source: raw.source ?? '',
    raw,
  }
}

/** 把一批原始数据归一化，过滤掉无效项。 */
export function normalizeSeriesList(list) {
  if (!Array.isArray(list)) return []
  return list.map(normalizeSeries).filter(Boolean)
}

/**
 * 从上游榜单接口的 cell_view 里摊平剧目。
 *
 * /reading/bookapi/bookmall/cell/change/v 的返回是三层嵌套
 * （cell_view.cell_data[].video_data[]），且一页只有约 10 条，
 * 这里压平成与本机后端同构的条目，让上层继续走 normalizeSeries 一条路。
 */
export function extractCellItems(res) {
  const cells = res?.data?.cell_view?.cell_data
  if (!Array.isArray(cells)) return []
  const out = []
  for (const cell of cells) {
    const videos = Array.isArray(cell?.video_data)
      ? cell.video_data
      : cell?.video_data
        ? [cell.video_data]
        : []
    for (const v of videos) {
      if (!v?.series_id) continue
      out.push({
        series_id: String(v.series_id),
        vid: v.vid ? String(v.vid) : '',
        title: v.title ?? '',
        cover: v.cover ?? '',
        episode_cnt: Number(v.episode_cnt ?? 0),
        play_cnt: Number(v.play_cnt ?? 0),
        score: v.score ?? '',
        hot: v.rec_text ?? '',
        copyright: v.copyright ?? '',
        intro: typeof v.video_desc === 'string' ? v.video_desc.slice(0, 120) : '',
      })
    }
  }
  return out
}

/** 从若干种响应形态里取出剧目数组。 */
export function extractSeriesList(res) {
  if (!res) return []
  if (Array.isArray(res)) return res
  if (Array.isArray(res.items)) return res.items
  if (Array.isArray(res.results)) return res.results
  const cells = extractCellItems(res)
  return cells.length ? cells : []
}

export function formatHot(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? '')
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)} 亿热度`
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万热度`
  return `${n} 热度`
}

/**
 * 把各种形态的 episodes 响应归一化为 [{ep, vid, title, duration, cover}]。
 *
 * 背景：曾经因为 /episodes 在某条路径下返回对象而非数组，
 * `episodes.filter` 抛错导致 React 卸载整棵树、整页白屏。
 * 这里做统一防御：数组 / 对象 / 错误响应都能安全处理。
 */
export function normalizeEpisodes(res) {
  const raw = res?.episodes ?? res?.items ?? res ?? []
  const list = Array.isArray(raw)
    ? raw
    : Object.values(raw ?? {}).map((v) =>
        v && typeof v === 'object' ? v : { title: String(v) },
      )

  return list
    .map((e, i) => ({
      ep: Number(e?.index ?? e?.ep ?? e?.episode ?? i + 1),
      vid: e?.vid ?? e?.video_id ?? '',
      title: e?.title ?? e?.name ?? '',
      duration: Number(e?.duration ?? 0),
      cover: e?.cover ?? '',
    }))
    .filter((e) => Number.isFinite(e.ep))
    .sort((a, b) => a.ep - b.ep)
}

/**
 * 解析封面。
 *
 * IPC 通道下 cover 可能是 `guoban-cover:<seriesId>` 占位协议，
 * 需要调 get_series_cover 换成 base64 data URL；
 * 真实远程 URL 则走 /img 代理（红果返回 HEIC，浏览器不支持）。
 */
export async function resolveCover(series, { getSeriesCover, imgProxy }) {
  const cover = series?.cover ?? ''
  if (!cover) return ''

  if (cover.startsWith('guoban-cover:')) {
    try {
      const dataUrl = await getSeriesCover({
        seriesId: series.id,
        title: series.title,
      })
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) return dataUrl
    } catch {
      /* 取不到就退回占位 */
    }
    return ''
  }

  if (/^https?:\/\//i.test(cover)) {
    try {
      return await imgProxy(cover)
    } catch {
      return cover
    }
  }

  return cover
}
