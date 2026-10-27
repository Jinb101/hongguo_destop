import { useCallback, useEffect, useRef, useState } from 'react'
import SmartCover from './SmartCover.jsx'
import { useResolvedCover } from '../lib/useResolvedCover.js'

/**
 * 竖向滑动推荐列表
 *
 * 产品诉求：「播放第一集的时候上下滑动切换，点击可以进去看更多」。
 *
 * 交互设计：
 *   - 竖向滚轮 / 触控上下滑动 → 逐张滚动切换（带吸附对齐）
 *   - 方向键 ↑↓ → 逐项移动
 *   - 点击任意一张 → 打开详情（更多）
 *   - 支持「换一个」按钮：换一批推荐
 *
 * 实现要点：
 *   - 用 scroll-snap 做吸附，避免滑动后停在两张之间。
 *   - 滚轮事件需要自己接管（passive: false 才能 preventDefault），
 *     否则一次滚轮会连带滚动整个页面，破坏沉浸感。
 */
export default function SwipeRecommend({
  items = [],
  onOpen,
  onSelect,
  title = '下一部看什么',
  emptyText = '暂时没有更多推荐',
  loading = false,
}) {
  const listRef = useRef(null)
  const [index, setIndex] = useState(0)

  /** 安全滚动：部分环境（如 jsdom）不实现 scrollTo。 */
  const scrollTo = useCallback((top) => {
    const el = listRef.current
    if (!el) return
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top, behavior: 'smooth' })
    } else {
      el.scrollTop = top
    }
  }, [])
  const wheelLock = useRef(false)
  const lockTimer = useRef(null)

  // 观察当前可见项
  useEffect(() => {
    const el = listRef.current
    if (!el) return undefined
    const onScroll = () => {
      const children = Array.from(el.children)
      if (!children.length) return
      const mid = el.scrollTop + el.clientHeight / 2
      let best = 0
      let bestDist = Infinity
      children.forEach((c, i) => {
        const center = c.offsetTop + c.offsetHeight / 2
        const dist = Math.abs(center - mid)
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      })
      setIndex(best)
    }
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [items.length])

  // 接管滚轮：一次滚动切一张
  const onWheel = useCallback(
    (e) => {
      if (!items.length) return
      if (Math.abs(e.deltaY) < 4) return
      e.preventDefault()
      if (wheelLock.current) return

      const dir = e.deltaY > 0 ? 1 : -1
      const next = Math.max(0, Math.min(items.length - 1, index + dir))
      if (next === index) return

      const target = listRef.current?.children[next]
      if (target) scrollTo(target.offsetTop - 8)
      setIndex(next)

      wheelLock.current = true
      clearTimeout(lockTimer.current)
      lockTimer.current = setTimeout(() => {
        wheelLock.current = false
      }, 420)
    },
    [index, items.length],
  )

  // 键盘上下
  const onKeyDown = useCallback(
    (e) => {
      if (!items.length) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        move(index + 1)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        move(index - 1)
      }
    },
    [index, items.length],
  )

  const move = useCallback(
    (target) => {
      const clamped = Math.max(0, Math.min(items.length - 1, target))
      const node = listRef.current?.children[clamped]
      if (node) scrollTo(node.offsetTop - 8)
      setIndex(clamped)
    },
    [items.length, scrollTo],
  )

  useEffect(() => {
    setIndex(0)
    scrollTo(0)
  }, [items, scrollTo])

  if (loading) {
    return (
      <div className="swipe">
        <h3 className="swipe-title">{title}</h3>
        <div className="swipe-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="swipe-item">
              <div className="skeleton" style={{ aspectRatio: '640 / 914' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="swipe">
        <h3 className="swipe-title">{title}</h3>
        <p className="muted">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="swipe">
      <header className="swipe-head">
        <h3 className="swipe-title">{title}</h3>
        <span className="swipe-hint">↑↓ 滑动切换 · 点击查看详情</span>
      </header>

      <div className="swipe-body">
        <div
          ref={listRef}
          className="swipe-list"
          tabIndex={0}
          role="listbox"
          aria-label={title}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
        >
          {items.map((item, i) => (
            <SwipeItem
              key={item.id ?? i}
              item={item}
              active={i === index}
              onClick={() => {
                setIndex(i)
                onOpen?.(item)
              }}
              onDoubleClick={() => onSelect?.(item)}
            />
          ))}
        </div>

        <div className="swipe-rail" aria-hidden="true">
          {items.map((item, i) => (
            <span
              key={item.id ?? i}
              className={`swipe-dot ${i === index ? 'is-active' : ''}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function formatHot(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)} 亿热度`
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万热度`
  return `${n} 热度`
}


/**
 * 单个推荐项。
 *
 * 封面需要单独解析：IPC 通道返回的 cover 常是 `guoban-cover:<id>` 占位协议，
 * 必须先换成真实 URL 才能显示，否则整块推荐区都是「无封面」。
 */
function SwipeItem({ item, active, onClick, onDoubleClick }) {
  const { cover } = useResolvedCover(item)
  const episodes = item.episodes ?? item.episodeCount ?? 0
  const hot = item.hot ?? ''
  const genre = (item.genres ?? [])[0] ?? ''

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`swipe-item ${active ? 'is-active' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <SmartCover
        src={cover}
        alt={item.title}
        width={item.coverWidth ?? 640}
        height={item.coverHeight ?? 914}
        badge={episodes ? <span className="badge-ep">全 {episodes} 集</span> : null}
      />
      <span className="swipe-caption">
        <span className="swipe-caption-title">{item.title}</span>
        <span className="swipe-caption-meta">
          {hot ? <span>{hot}</span> : null}
          {genre ? <span> · {genre}</span> : null}
        </span>
      </span>
    </button>
  )
}
