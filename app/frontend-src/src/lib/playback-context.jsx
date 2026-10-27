import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { fetchEpisodes, resolveStream } from './playback.js'

/**
 * 播放会话管理
 *
 * 目标（来自产品诉求）：
 *   1. 播放时不影响继续找其他剧 —— 播放会话独立于当前页面存在，
 *      切页/切剧不会中断当前视频。
 *   2. 小窗播放 —— 播放页之外可以把视频收进一个悬浮小窗，
 *      继续在列表里浏览。
 *   3. 上下滑动切换 —— 推荐列表支持上下滚动连续浏览，
 *      点任意一张即可跳过去看。
 *
 * 设计要点：
 *   - 用一个全局 PlayerSession 持有 <video> 元素的引用，
 *     视频元素本身不随页面卸载而销毁，因此切页不黑屏、不重新加载。
 *   - 小窗与大窗共用同一个 <video>，只是挂载到不同容器，
 *     不做 src 重置，因此不会重新缓冲。
 */

const PlaybackContext = createContext(null)

export function PlaybackProvider({ children }) {
  /** 当前播放的剧目信息 */
  const [current, setCurrent] = useState(null)
  /** 播放状态：idle | resolving | ready | error */
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  /** 展示模式：'full' 全屏播放页 | 'mini' 悬浮小窗 | 'hidden' 不显示 */
  const [mode, setMode] = useState('hidden')
  /** 剧集列表 */
  const [episodes, setEpisodes] = useState([])
  /** 当前集号 */
  const [ep, setEp] = useState(1)
  /** 视频地址 */
  const [src, setSrc] = useState(null)
  /** 进度（秒） */
  const [position, setPosition] = useState(0)
  /** 倍速 */
  const [rate, setRate] = useState(1)
  /** 静音 */
  const [muted, setMuted] = useState(false)

  const videoRef = useRef(null)
  const resolverRef = useRef(null)

  /** 切换剧目并解析播放源。 */
  const play = useCallback(async (series, targetEp = 1) => {
    setCurrent(series)
    setEp(targetEp)
    setMode('full')
    setStatus('resolving')
    setError(null)
    setSrc(null)

    // 剧集列表：能拿到就缓存起来用于「上一集/下一集」
    if (!episodes.length || episodes[0]?.seriesId !== series.id) {
      setEpisodes([])
    }

    const token = ++resolverRef.current
    try {
      const url = await resolveStream(series.id, targetEp)
      if (resolverRef.current !== token) return // 已被更新的请求取代
      setSrc(url)
      setStatus('ready')
    } catch (e) {
      if (resolverRef.current !== token) return
      setStatus('error')
      setError(e.message ?? String(e))
    }
  }, [episodes])

  /** 载入剧集列表（不改变播放状态）。 */
  const loadEpisodes = useCallback(async (seriesId) => {
    if (!seriesId) return []
    try {
      const list = await fetchEpisodes(seriesId)
      setEpisodes(list)
      return list
    } catch {
      setEpisodes([])
      return []
    }
  }, [])

  /** 切集。 */
  const changeEp = useCallback(
    async (nextEp) => {
      if (!current) return
      await play(current, nextEp)
    },
    [current, play],
  )

  /** 收起为小窗。 */
  const minimize = useCallback(() => setMode('mini'), [])
  /** 展开回全屏。 */
  const expand = useCallback(() => setMode('full'), [])
  /** 完全关闭播放。 */
  const stop = useCallback(() => {
    resolverRef.current += 1
    setCurrent(null)
    setSrc(null)
    setStatus('idle')
    setMode('hidden')
    setEpisodes([])
    setPosition(0)
  }, [])

  /** 切换播放/暂停。 */
  const toggle = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [])

  const setPlaybackRate = useCallback((next) => {
    setRate(next)
    if (videoRef.current) videoRef.current.playbackRate = next
  }, [])

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      if (videoRef.current) videoRef.current.muted = !prev
      return !prev
    })
  }, [])

  const seek = useCallback((delta) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
  }, [])

  const api = useMemo(
    () => ({
      current,
      status,
      error,
      mode,
      episodes,
      ep,
      src,
      position,
      rate,
      muted,
      videoRef,
      play,
      loadEpisodes,
      changeEp,
      minimize,
      expand,
      stop,
      toggle,
      setPlaybackRate,
      toggleMuted,
      seek,
      setPosition,
    }),
    [
      current, status, error, mode, episodes, ep, src, position, rate, muted,
      play, loadEpisodes, changeEp, minimize, expand, stop, toggle,
      setPlaybackRate, toggleMuted, seek,
    ],
  )

  return <PlaybackContext.Provider value={api}>{children}</PlaybackContext.Provider>
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext)
  if (!ctx) throw new Error('usePlayback 必须在 PlaybackProvider 内使用')
  return ctx
}
