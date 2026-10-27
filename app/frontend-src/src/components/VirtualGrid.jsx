import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * 窗口化网格（按行虚拟化）
 *
 * 原版问题：`series-grid` 用 auto-fill 布局一次性渲染全部条目，
 * 排行榜 30 条 + 今日上新 120 条 + 探索 119 条会同时进入 DOM。
 *
 * 本组件只渲染「视口内 + 缓冲区」的行，滚动时增量补齐，
 * DOM 规模从 O(总数) 降到 O(可见行数)。
 */
export default function VirtualGrid({
  items = [],
  renderItem,
  minRowHeight = 320,
  overscan = 2,
  gap = 18,
  className = '',
  emptyState = null,
}) {
  const containerRef = useRef(null)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    const update = () => {
      setViewport({ top: el.scrollTop, height: el.clientHeight })
    }
    update()

    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  const { visibleItems, padTop, padBottom } = useMemo(() => {
    const total = items.length
    if (!total) return { visibleItems: [], padTop: 0, padBottom: 0 }

    const rowHeight = minRowHeight + gap
    const firstRow = Math.max(0, Math.floor(viewport.top / rowHeight) - overscan)
    const lastRow = Math.min(
      Math.ceil(total / columnCount()) - 1,
      Math.ceil((viewport.top + viewport.height) / rowHeight) + overscan,
    )

    const start = firstRow * columnCount()
    const end = Math.min(total, (lastRow + 1) * columnCount())

    return {
      visibleItems: items.slice(start, end),
      padTop: firstRow * rowHeight,
      padBottom: Math.max(0, (Math.ceil(total / columnCount()) - lastRow - 1) * rowHeight),
    }
    // columnCount 依赖容器宽度，这里用 ref 宽度近似
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, viewport, minRowHeight, overscan, gap])

  function columnCount() {
    const el = containerRef.current
    if (!el) return 1
    const width = el.clientWidth || 1
    // 与 CSS 的 minmax(150px, 1fr) 保持一致
    const columns = Math.max(1, Math.floor((width + gap) / (150 + gap)))
    return columns
  }

  if (!items.length) return emptyState

  return (
    <div ref={containerRef} className={`vgrid ${className}`} style={{ overflowY: 'auto' }}>
      <div style={{ height: padTop }} aria-hidden="true" />
      <div className="vgrid-inner">
        {visibleItems.map((item, index) => renderItem(item, index))}
      </div>
      <div style={{ height: padBottom }} aria-hidden="true" />
    </div>
  )
}
