import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePlayback } from '../lib/playback-context.jsx'
import VideoSurface from './VideoSurface.jsx'

/**
 * 悬浮小窗播放器
 *
 * 产品诉求：「播放的时候不影响我找其他的」。
 * 做法：把播放页收起成一个可拖动的悬浮小窗，
 * 用户继续在列表里浏览、搜索、收藏，视频继续播放。
 *
 * 交互：
 *   - 拖动标题栏移动窗口，松手时吸附到最近的窗口边缘
 *   - 双击标题栏 收起/展开
 *   - 右上角：加宽 / 回到播放页 / 关闭
 *   - 位置、宽度都会记住，下次播放沿用
 */
const POS_KEY = 'hongguo:mini-player-pos'
const WIDE_KEY = 'hongguo:mini-player-wide'

const MARGIN = 16
const TOP_GAP = 60
const SNAP = 36

const NARROW_W = 380
const WIDE_W = 470

function readPos() {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p
    }
  } catch {
    /* 忽略损坏的存储 */
  }
  return { x: window.innerWidth - NARROW_W - 24, y: window.innerHeight - 300 }
}

export default function MiniPlayer() {
  const { mode, expand, stop, current, status } = usePlayback()
  const [pos, setPos] = useState(readPos)
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem(WIDE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [collapsed, setCollapsed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef(null)
  const hostRef = useRef(null)
  const posRef = useRef(pos)
  posRef.current = pos

  // 持久化位置与宽度
  useEffect(() => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos))
    } catch {
      /* 忽略写入失败 */
    }
  }, [pos])

  useEffect(() => {
    try {
      localStorage.setItem(WIDE_KEY, wide ? '1' : '0')
    } catch {
      /* 忽略写入失败 */
    }
  }, [wide])

  /** 把窗口拉回可视区（顶栏下方也要留白，避免被拖到标题栏里）。 */
  const clamp = useCallback((p) => {
    const w = hostRef.current?.offsetWidth ?? (wide ? WIDE_W : NARROW_W)
    const h = hostRef.current?.offsetHeight ?? 260
    const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN)
    const maxY = Math.max(TOP_GAP, window.innerHeight - h - MARGIN)
    return {
      x: Math.min(Math.max(MARGIN, p.x), maxX),
      y: Math.min(Math.max(TOP_GAP, p.y), maxY),
    }
  }, [wide])

  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p))
    window.addEventListener('resize', onResize)
    // 首次挂载也校正一次（上次的位置可能来自更小的窗口）
    setPos((p) => clamp(p))
    return () => window.removeEventListener('resize', onResize)
  }, [clamp])

  const onPointerDown = useCallback(
    (e) => {
      if (e.button !== 0) return
      dragRef.current = {
        dx: e.clientX - posRef.current.x,
        dy: e.clientY - posRef.current.y,
      }
      setDragging(true)
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    [],
  )

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return
    setPos(clamp({
      x: e.clientX - dragRef.current.dx,
      y: e.clientY - dragRef.current.dy,
    }))
  }, [clamp])

  /** 松手时吸附：靠近哪条边就贴住哪条边。 */
  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    setPos((p) => {
      const w = hostRef.current?.offsetWidth ?? NARROW_W
      const h = hostRef.current?.offsetHeight ?? 260
      let { x, y } = clamp(p)
      if (x - MARGIN < SNAP) x = MARGIN
      if (window.innerWidth - w - MARGIN - x < SNAP) x = window.innerWidth - w - MARGIN
      if (y - TOP_GAP < SNAP) y = TOP_GAP
      if (window.innerHeight - h - MARGIN - y < SNAP) y = window.innerHeight - h - MARGIN
      return clamp({ x, y })
    })
  }, [clamp])

  if (mode !== 'mini' || !current) return null

  return createPortal(
    <div
      ref={hostRef}
      className={`miniplayer ${dragging ? 'is-dragging' : ''} ${collapsed ? 'is-collapsed' : ''} ${wide && !collapsed ? 'is-wide' : ''}`}
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
    >
      <div
        className="miniplayer-bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setCollapsed((v) => !v)}
      >
        <span className="miniplayer-grip" aria-hidden="true" />
        <span className="miniplayer-title">
          {status === 'resolving' ? '解析中…' : current.title}
        </span>
        <span className="miniplayer-actions">
          <button
            type="button"
            className="miniplayer-btn"
            onClick={(e) => {
              e.stopPropagation()
              setWide((v) => !v)
            }}
            aria-label={wide ? '缩小窗口' : '加宽窗口'}
            title={wide ? '缩小' : '加宽'}
          >
            <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
              {wide ? <path d="M8 6 4.5 9.5M8 6H5.6M8 6v2.4" /> : <path d="M6 8l3.5-3.5M6 8h2.4M6 8V5.6" />}
            </svg>
          </button>
          <button
            type="button"
            className="miniplayer-btn"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed((v) => !v)
            }}
            aria-label={collapsed ? '展开小窗' : '收起小窗'}
            title={collapsed ? '展开' : '收起'}
          >
            <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {collapsed ? <path d="M3.5 8.5 7 5l3.5 3.5" /> : <path d="M3.5 5.5 7 9l3.5-3.5" />}
            </svg>
          </button>
          <button
            type="button"
            className="miniplayer-btn"
            onClick={(e) => {
              e.stopPropagation()
              expand()
            }}
            aria-label="展开为全屏播放"
            title="回到播放页"
          >
            <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8.5 2.5H11.5V5.5M5.5 11.5H2.5V8.5M11.5 2.5 8 6M2.5 11.5 6 8" />
            </svg>
          </button>
          <button
            type="button"
            className="miniplayer-btn is-danger"
            onClick={(e) => {
              e.stopPropagation()
              stop()
            }}
            aria-label="关闭播放"
            title="关闭"
          >
            <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="m3.5 3.5 7 7M10.5 3.5l-7 7" />
            </svg>
          </button>
        </span>
      </div>

      {!collapsed && (
        <div className="miniplayer-body">
          <VideoSurface className="is-mini" />
        </div>
      )}
    </div>,
    document.body,
  )
}
