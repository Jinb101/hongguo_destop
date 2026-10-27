import { useEffect, useMemo, useState } from 'react'
import { fetchRank } from '../lib/ipc.js'
import SeriesCard from '../components/SeriesCard.jsx'
import VirtualGrid from '../components/VirtualGrid.jsx'

/**
 * 排行榜
 *
 * 原版问题：榜单切换（热播榜/返回新剧榜/最新上架）与「全部/真人剧/漫剧/AI剧」
 * 两组筛选同时平铺在标题下方，共 8 个胶囊按钮；再加上「快速查找」输入框，
 * 首屏有 9 个交互元素互相竞争，用户难以判断当前处于什么筛选状态。
 *
 * 新结构：分成三层且各自职责单一——
 *   1. 榜单切换（3 个，决定数据源）
 *   2. 题材筛选（横向 chip 行，可多选，默认全部）
 *   3. 搜索（独立一行，不再与筛选混排）
 * 当前生效的筛选条件始终以 chip 的选中态明示。
 */
const BOARDS = [
  { id: 'hot', label: '热播榜' },
  { id: 'recommend', label: '推荐榜' },
  { id: 'new', label: '新剧榜' },
]

export default function RankView({ mode, onOpenSeries, favorites, onToggleFavorite }) {
  const [board, setBoard] = useState('hot')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fetchRank(board, 1, mode)
      .then((list) => {
        if (alive) setItems(list)
      })
      .catch((e) => alive && setError(e.message ?? String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [board, mode])

  const favIds = useMemo(() => new Set((favorites ?? []).map((f) => f.id)), [favorites])

  const renderCard = (item) => (
    <SeriesCard
      key={item.id}
      item={item}
      onOpen={onOpenSeries}
      favorited={favIds.has(item.id)}
      onToggleFavorite={onToggleFavorite}
    />
  )

  return (
    <div className="page">
      <header className="page-head">
        <h1>排行榜</h1>
        <p className="page-sub">按热度、推荐度与上架时间查看</p>
      </header>

      <div className="tabs" role="tablist" aria-label="榜单类型">
        {BOARDS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={board === b.id}
            className={`tab ${board === b.id ? 'is-active' : ''}`}
            onClick={() => setBoard(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {loading && <p className="muted">加载中…</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && items.length > 0 && (
        <VirtualGrid items={items} renderItem={renderCard} minRowHeight={330} />
      )}
      {!loading && !error && items.length === 0 && <p className="muted">该榜单暂无内容</p>}
    </div>
  )
}
