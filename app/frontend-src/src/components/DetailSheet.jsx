import { useEffect, useRef } from 'react'
import { useResolvedCover } from '../lib/useResolvedCover.js'

/**
 * 详情抽屉（右侧滑出）
 *
 * 原版用的是居中 modal + 背景遮罩，用户想「看一眼简介再返回列表」时
 * 必须完全关闭再打开，割裂了浏览连续性。改为右侧抽屉：
 *  - 列表保持可见可滚动，随时可关闭。
 *  - ESC / 点击遮罩 / 关闭按钮三种方式都能退出。
 *  - 打开时焦点移入抽屉，关闭时归还给触发元素（键盘可达）。
 */
export default function DetailSheet({ series, episodes = [], onClose, onPlay, onToggleFavorite, favorited }) {
  const ref = useRef(null)
  // cover 可能是 `guoban-cover:<id>` 占位协议，需要解析成真实 URL
  const { cover } = useResolvedCover(series)
  const restoreRef = useRef(null)

  useEffect(() => {
    if (!series) return undefined
    restoreRef.current = document.activeElement
    ref.current?.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('is-locked')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('is-locked')
      restoreRef.current?.focus?.()
    }
  }, [series, onClose])

  if (!series) return null

  const title = series.title ?? series.name ?? ''
  const total = series.total_episode ?? episodes.length ?? 0

  return (
    <div className="sheet-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <aside
        className="sheet"
        role="dialog"
        aria-modal="false"
        aria-label={`${title} 详情`}
        tabIndex={-1}
        ref={ref}
      >
        <button
          type="button"
          className="sheet-close"
          onClick={onClose}
          aria-label="关闭详情"
          data-tauri-drag-region="false"
          data-window-drag="false"
        >
          ×
        </button>

        <div className="sheet-hero" data-tauri-drag-region="deep" data-window-drag>
          <div
            className="sheet-cover"
            style={cover ? { backgroundImage: `url(${cover})` } : undefined}
          />
          <div className="sheet-hero-info">
            <h2>{title}</h2>
            <div className="sheet-tags">
              {series.genre_name && <span>{series.genre_name}</span>}
              {total ? <span>全 {total} 集</span> : null}
              {series.hot_score ? <span>{series.hot_score} 热度</span> : null}
            </div>
            {series.description && <p className="sheet-desc">{series.description}</p>}
          </div>
        </div>

        <div className="sheet-actions" data-tauri-drag-region="false" data-window-drag="false">
          <button type="button" className="btn btn-primary" onClick={() => onPlay?.(series, 1)}>
            立即播放
          </button>
          <button
            type="button"
            className={`btn ${favorited ? 'btn-on' : 'btn-ghost'}`}
            onClick={() => onToggleFavorite?.(series)}
          >
            {favorited ? '已收藏' : '收藏'}
          </button>
        </div>

        {episodes.length > 0 && (
          <section className="sheet-section" data-tauri-drag-region="false" data-window-drag="false">
            <h3>选集</h3>
            <div className="ep-grid">
              {episodes.map((ep) => {
                const n = ep.ep ?? ep
                return (
                  <button
                    key={n}
                    type="button"
                    className="ep"
                    onClick={() => onPlay?.(series, n)}
                    title={ep.title ?? `第 ${n} 集`}
                  >
                    第 {n} 集
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </aside>
    </div>
  )
}
