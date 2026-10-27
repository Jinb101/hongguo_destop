import { useEffect, useRef } from 'react'
import { usePlayback } from '../lib/playback-context.jsx'

/**
 * 视频播放器（单实例）
 *
 * 关键设计：整个应用只存在一个 <video> 元素。
 * 它通过 React portal 挂载到「全屏播放页」或「悬浮小窗」两个容器之一，
 * 切换容器时 DOM 节点会被移动而不是销毁重建，
 * 因此播放进度、缓冲状态、暂停状态全部保留 —— 这正是
 * 「播放时不影响我找其他的」能成立的前提。
 */
export default function VideoSurface({ className = '' }) {
  const {
    videoRef,
    src,
    status,
    error,
    current,
    ep,
    episodes,
    position,
    setPosition,
    rate,
    muted,
    toggle,
    changeEp,
    seek,
  } = usePlayback()

  const localRef = useRef(null)

  // 把本地 ref 同步给 context 的 videoRef
  useEffect(() => {
    videoRef.current = localRef.current
    return () => {
      if (videoRef.current === localRef.current) videoRef.current = null
    }
  }, [videoRef])

  // src 变化后自动播放
  useEffect(() => {
    const v = localRef.current
    if (!v || !src) return
    v.currentTime = 0
    v.play().catch(() => {
      /* 浏览器可能拦截自动播放，保持暂停等待用户点击 */
    })
  }, [src])

  // 倍速同步
  useEffect(() => {
    const v = localRef.current
    if (v) v.playbackRate = rate
  }, [rate])

  // 静音同步
  useEffect(() => {
    const v = localRef.current
    if (v) v.muted = muted
  }, [muted])

  // 键盘快捷键：空格播放/暂停，左右方向键快退快进
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowLeft') {
        seek(-10)
      } else if (e.key === 'ArrowRight') {
        seek(10)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, seek])

  const total = episodes.length
  const hasPrev = ep > 1
  const hasNext = total > 0 && ep < total

  return (
    <div className={`vsurface ${className}`}>
      <video
        ref={localRef}
        className="vsurface-video"
        src={src ?? undefined}
        controls
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onError={() => {
          /* 错误状态由 status 管理，这里只防止未捕获异常 */
        }}
      />

      {status === 'resolving' && (
        <div className="vsurface-mask">
          <span className="spinner" aria-hidden="true" />
          <p>正在解析第 {ep} 集…</p>
          <small>首次解析需要下载并解密，请稍候</small>
        </div>
      )}

      {status === 'error' && (
        <div className="vsurface-mask">
          <div className="empty-icon" aria-hidden="true">!</div>
          <p>本集暂时无法播放</p>
          <small>{error}</small>
          <div className="vsurface-mask-actions">
            <button type="button" className="btn btn-primary" onClick={() => changeEp(ep)}>
              重试
            </button>
            {hasPrev && (
              <button type="button" className="btn btn-ghost" onClick={() => changeEp(ep - 1)}>
                上一集
              </button>
            )}
          </div>
        </div>
      )}

      {status === 'ready' && (
        /*
         * 剧名/上下集 信息条放在**顶部**。
         * 原先放在底部会盖住 <video> 原生 controls 操作栏
         * （进度条、音量、全屏按钮全被遮住，点不到）。
         * 顶部是原生控件不占用的区域，互不干扰。
         */
        <div className="vsurface-overlay">
          <div className="vsurface-meta">
            <strong>{current?.title ?? ''}</strong>
            <span>
              第 {ep} 集{total ? ` / 共 ${total} 集` : ''}
            </span>
          </div>
          <div className="vsurface-jump">
            <button type="button" className="btn-ghost" disabled={!hasPrev} onClick={() => changeEp(ep - 1)}>
              上一集
            </button>
            <button type="button" className="btn-ghost" disabled={!hasNext} onClick={() => changeEp(ep + 1)}>
              下一集
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
