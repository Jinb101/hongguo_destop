import { useEffect, useRef, useState } from 'react'
import CoverLazy from './CoverLazy.jsx'
import { coverPlaceholder } from '../lib/useResolvedCover.js'

/**
 * 智能封面
 *
 * 逆向还原发现的性能问题：
 *   原版首页一次性渲染 135 张封面，全部 `loading="eager"`，
 *   每张都是 640x914 的 base64 内联图（单张约 17KB，合计 2.2MB），
 *   且 135 个元素各带 box-shadow、290 个元素带 transition。
 *   结果是：DOM 节点 2102 个、滚动高度 11901px、切换页面明显掉帧。
 *
 * 本组件的修复：
 *   1. loading="lazy" + decoding="async"：只加载视口内的图。
 *   2. IntersectionObserver：图片进入 300px 视口才真正挂 src。
 *   3. blur-up 占位：用低分辨率底图 + 模糊占位，图片到达后淡入，避免白屏跳动。
 *   4. 尺寸预留：固定 aspect-ratio，布局不会因图片加载而抖动（消除 CLS）。
 *   5. 原生 lazy 原生兜底：无 IntersectionObserver 时退化为 loading="lazy"。
 */
export default function SmartCover({
  src,
  alt,
  width,
  height,
  className = '',
  eager = false,
  onClick,
  badge,
}) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(eager)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (eager || visible) return undefined
    const el = ref.current
    if (!el) return undefined

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return undefined
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [eager, visible])

  // src 变化时重置加载态
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [src])

  const ratio = width && height ? `${width} / ${height}` : '2 / 3'

  return (
    <div
      ref={ref}
      className={`cover ${className}`}
      style={{ aspectRatio: ratio }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick(e)
              }
            }
          : undefined
      }
    >
      {!failed && (
        <CoverLazy src={src}>
          {(resolved) => (
            <img
              className={`cover-img ${loaded ? 'is-loaded' : ''}`}
              src={visible && resolved ? resolved : undefined}
              alt={alt ?? ''}
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          )}
        </CoverLazy>
      )}
      {/*
        封面加载失败（上游确实存在查不到封面的剧）：
        直接用渐变占位图顶上，而不是显示「无封面」文字。
        保持网格视觉整齐，不留空洞。
      */}
      {failed && (
        <img
          className="cover-img is-loaded"
          src={coverPlaceholder(alt || src)}
          alt={alt ?? ''}
          aria-hidden="true"
        />
      )}
      {!loaded && !failed && <div className="cover-skeleton" aria-hidden="true" />}
      {badge ? <div className="cover-badge">{badge}</div> : null}
    </div>
  )
}
