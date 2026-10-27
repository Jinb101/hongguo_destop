import { call, fetchNewReleases, fetchRank } from './ipc.js'
import { normalizeEpisodes } from './normalize.js'

export { normalizeEpisodes }

/**
 * 播放链路封装
 *
 * 后端能力（逆向自 app/backend/server.py 与 exe 命令注册表）：
 *   HTTP 通道（浏览器开发模式）：
 *     GET /episodes?series_id= -> { meta, episodes:[{index,vid,title,duration,cover}] }
 *     GET /stream?vid=&api_key= -> 已离线解密的 mp4（支持 Range）
 *   IPC 通道（打包进 exe 后）：
 *     get_validation_episodes { seriesId }
 *         -> { seriesId, title, total, episodes: [1,2,3,...] }   ← 集号数组
 *     get_validation_playback { seriesId, episode }
 *         -> { seriesId, episode, total, title,
 *              streamUrl, streamFormat:'hls', hlsWindow, source }
 *
 * 注意：
 *  - <video> 标签无法带请求头，密钥必须走 query（后端 server.py 的 /stream 注释明确说明）。
 *  - IPC 通道的 episodes 是**集号数组**（[1,2,3...]），不是对象数组，要分别处理。
 *  - get_desktop_playback 需要登录态（HONGGUO_DESKTOP_AUTH_*），
 *    未配置时会抛错；游客态应使用 get_validation_playback。
 */

/** 拉取剧集列表，归一化成 [{ep, vid, title, duration, cover}]。 */
export async function fetchEpisodes(seriesId) {
  const res = await call('get_validation_episodes', { seriesId })

  // IPC 通道：episodes 是集号数组 [1,2,3...]
  const raw = res?.episodes
  if (Array.isArray(raw) && raw.length && typeof raw[0] === 'number') {
    return raw
      .map((n) => ({ ep: Number(n), vid: '', title: '', duration: 0, cover: '' }))
      .filter((e) => Number.isFinite(e.ep))
      .sort((a, b) => a.ep - b.ep)
  }

  return normalizeEpisodes(res)
}

/**
 * 解析某一集的可播地址。
 *
 * 播放直链来自 /novel/player/multi_video_model/v1/，免签实测返回 200 空 body，
 * 因此这一条现在必然抛错，由播放页显示"需要签名服务"。
 * 保留这个函数是因为一旦签名服务恢复，播放链路只改路由表一处即可。
 */
export async function resolveStream(seriesId, ep) {
  const res = await call('get_validation_playback', { seriesId, episode: ep })
  const url = res?.streamUrl ?? res?.url ?? res?.play_url
  if (!url) throw new Error('未取到该集的播放地址')
  return url
}

/**
 * 批量取某剧的推荐（用于播放页「下一部看什么」）。
 * 数据来源：排行榜 + 最新上架，排除当前剧。
 */
export async function fetchRecommendations(currentSeriesId, limit = 12) {
  const sources = await Promise.allSettled([
    fetchRank('hot', 1),
    fetchNewReleases('short_play'),
  ])

  const merged = []
  const seen = new Set()
  for (const s of sources) {
    if (s.status !== 'fulfilled') continue
    for (const it of s.value) {
      const id = it?.id
      if (!id || id === currentSeriesId || seen.has(id)) continue
      seen.add(id)
      merged.push(it)
    }
  }
  return merged.slice(0, limit)
}
