import { useEffect, useState } from 'react'
import { fetchCover } from '../lib/ipc.js'

/**
 * 封面解析器
 *
 * IPC 通道下 Rust 侧返回的 cover 可能是占位协议 `guoban-cover:<seriesId>`，
 * 这不是合法 URL，直接塞进 <img src> 会显示「无封面」。
 * 需要调 get_series_cover 换成 data:image/jpeg;base64,...
 *
 * 真实远程 URL（http/https）则交给 SmartCover 的代理逻辑走 /img。
 * 组件负责把「占位协议 → 真实 URL」这一步补上，其余交给上层。
 */
/**
 * 封面占位图
 *
 * 上游确实存在「查不到封面」的剧（get_series_cover 报"暂未找到该剧封面"）。
 * 这时不能显示刺眼的「无封面」文字 —— 用一张按剧名生成的渐变图占位，
 * 视觉上与真实封面协调，也不会让网格出现空洞。
 */
export function coverPlaceholder(seed) {
  const text = String(seed ?? '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360
  }
  const h = hash
  const h2 = (hash + 40) % 360
  const initial = text.trim().slice(0, 1) || '剧'
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="457" viewBox="0 0 320 457">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h},30%,24%)"/>` +
    `<stop offset="1" stop-color="hsl(${h2},34%,16%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="320" height="457" fill="url(#g)"/>` +
    `<text x="160" y="238" font-size="76" fill="rgba(255,255,255,.14)" ` +
    `text-anchor="middle" font-family="sans-serif">${initial}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function useResolvedCover(series) {
  const [cover, setCover] = useState(series?.cover ?? '')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    const raw = series?.cover ?? ''
    setCover(raw)

    // 三种情况需要请求：
    //   1. cover 是 guoban-cover:<id> 占位协议 → 必须换成真实 URL
    //   2. cover 为空（历史记录里常见）→ 用 seriesId 补一张
    //   3. cover 是真实 http(s) URL → 交给 SmartCover 的 /img 代理处理
    const needResolve = series?.coverIsProxy || (!raw && series?.id)
    if (!needResolve) {
      setLoading(false)
      return undefined
    }

    setLoading(true)
    fetchCover(series)
      .then((url) => {
        if (alive) {
          setCover(url || raw)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [series])

  return { cover, loading }
}
