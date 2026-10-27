import { useEffect, useMemo, useState } from 'react'
import { call, fetchNewReleases } from '../lib/ipc.js'
import SeriesCard from '../components/SeriesCard.jsx'
import VirtualGrid from '../components/VirtualGrid.jsx'
import SearchBox from '../components/SearchBox.jsx'

/**
 * 探索片库
 *
 * 原版问题：筛选维度（题材/设定/背景/排序/受众/时间/状态）平铺成两行 chip，
 * 加上「快速查找」输入框和「换题材 / 刷新片单」按钮，一屏 20+ 控件。
 *
 * 新结构：筛选收进一个「筛选」抽屉（侧边面板），主区域只保留
 * 已选条件的可移除 chip 列表 + 结果网格。条件可见、可撤销、可一键清空。
 */
export default function ExploreView({ mode, onOpenSeries, favorites, onToggleFavorite }) {
  const [filters, setFilters] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState({})

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    Promise.all([
      call('get_category_options', { genre: mode }),
      fetchNewReleases(mode),
    ])
      .then(([f, list]) => {
        if (!alive) return
        const rows = f?.rows ?? f
        setFilters(Array.isArray(rows) ? rows : [])
        setItems(Array.isArray(list) ? list : [])
      })
      .catch((e) => alive && setError(e.message ?? String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [mode])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = Array.isArray(items) ? items : []
    if (!q) return list
    return list.filter((i) => (i.title ?? i.name ?? '').toLowerCase().includes(q))
  }, [items, query])

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

  const activeChips = Object.entries(applied).filter(([, v]) => v)

  return (
    <div className="page">
      <header className="page-head">
        <h1>探索片库</h1>
        <p className="page-sub">按题材、设定、背景逐层缩小范围</p>
      </header>

      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="在结果中查找" compact />
        <button
          type="button"
          className={`btn ${activeChips.length ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setPanelOpen(true)}
        >
          筛选{activeChips.length ? ` · ${activeChips.length}` : ''}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setApplied({})
            fetchNewReleases(mode).then((list) => setItems(list))
          }}
        >
          重置
        </button>
      </div>

      {activeChips.length > 0 && (
        <div className="chips">
          {activeChips.map(([key, value]) => (
            <button
              key={key}
              type="button"
              className="chip is-on"
              onClick={() => setApplied((p) => ({ ...p, [key]: '' }))}
            >
              {labelOf(filters, key)}：{value} ×
            </button>
          ))}
        </div>
      )}

      {loading && <p className="muted">正在获取片库…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && visible.length > 0 && (
        <VirtualGrid items={visible} renderItem={renderCard} minRowHeight={330} />
      )}
      {!loading && !error && visible.length === 0 && (
        <p className="muted">没有匹配的剧目，试试放宽筛选条件</p>
      )}

      {panelOpen && (
        <FilterPanel
          filters={filters ?? []}
          applied={applied}
          onApply={(next) => {
            setApplied(next)
            setPanelOpen(false)
            const params = { genre: mode }
            for (const [k, v] of Object.entries(next)) if (v) params[k] = v
            setLoading(true)
            fetchNewReleases(params.genre ?? mode).then((list) => setItems(list))
              .catch(() => {})
              .finally(() => setLoading(false))
          }}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  )
}

function labelOf(filters, key) {
  const row = (filters ?? []).find((f) => f.key === key || f.type === key || f.name === key)
  return row?.name ?? row?.label ?? key
}

function FilterPanel({ filters, applied, onApply, onClose }) {
  const [draft, setDraft] = useState(applied)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="sheet sheet-narrow" role="dialog" aria-label="筛选条件">
        <button type="button" className="sheet-close" onClick={onClose} aria-label="关闭筛选">
          ×
        </button>
        <h2 className="sheet-title">筛选</h2>

        <div className="filter-body">
          {(filters ?? []).map((row) => {
            const key = row.key ?? row.type ?? row.name
            const options = row.items ?? row.options ?? row.select_items ?? []
            const current = draft[key] ?? ''
            const multi = row.multi ?? (row.type === 'multi_select')
            return (
              <div key={key} className="filter-group">
                <h3>{row.name ?? row.label ?? key}</h3>
                <div className="chips">
                  {(Array.isArray(options) ? options : []).map((opt) => {
                    const val = opt.id ?? opt.name
                    const name = opt.name ?? opt.id
                    const selected = multi
                      ? String(current).split(',').includes(String(val))
                      : current === val
                    return (
                      <button
                        key={String(val)}
                        type="button"
                        className={`chip ${selected ? 'is-on' : ''}`}
                        onClick={() => {
                          setDraft((d) => {
                            const next = { ...d }
                            if (multi) {
                              const set = new Set(
                                String(next[key] ?? '').split(',').filter(Boolean),
                              )
                              if (set.has(String(val))) set.delete(String(val))
                              else set.add(String(val))
                              next[key] = [...set].join(',')
                            } else {
                              next[key] = selected ? '' : String(val)
                            }
                            return next
                          })
                        }}
                      >
                        {name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-ghost" onClick={() => setDraft({})}>
            清空
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onApply(draft)}>
            应用筛选
          </button>
        </div>
      </aside>
    </div>
  )
}
