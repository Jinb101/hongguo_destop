import { useEffect, useState } from 'react'

/**
 * 懒挂载封面
 *
 * 原版前端对每张封面都调一次 `get_series_cover`，由 Rust 代理到 Python 的 /img，
 * 目的是把红果的 HEIC 转成 JPEG。实测（2026-10-27）榜单里给的是
 * `tplv-...-superreso-aifit` 直链，任意 UA 直接返回 image/jpeg，
 * WebView2 能正常解码，所以这一层不再代理，只保留它真正有价值的部分：
 * 首屏先挂内联渐变占位，等浏览器空闲再把真实 URL 交给 <img>，
 * 避免原版"135 张封面同时抢网络与解码"拖住主线程。
 */

/** 与剧名同色系的轻量占位（不请求网络）。 */
function placeholderFor(seed) {
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

export default function CoverLazy({ src, children }) {
  const [resolved, setResolved] = useState(null)

  useEffect(() => {
    if (!src) {
      setResolved(null)
      return undefined
    }
    let alive = true
    const schedule =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (fn) => setTimeout(fn, 120)
    const handle = schedule(() => {
      if (alive) setResolved(src)
    })
    return () => {
      alive = false
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle)
    }
  }, [src])

  return children(resolved ?? placeholderFor(src))
}
