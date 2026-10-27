import { useEffect, useState } from 'react'
import { searchSeries } from '../lib/ipc.js'
import SeriesCard from '../components/SeriesCard.jsx'
import VirtualGrid from '../components/VirtualGrid.jsx'
import SearchBox from '../components/SearchBox.jsx'
import { useToast } from '../components/Toast.jsx'

/**
 * 搜索页
 *
 * 原版把搜索框放在顶栏，搜索结果直接替换整个内容区，
 * 搜索时用户失去「当前在哪个频道」的上下文；且每次输入都打一次接口。
 *
 * 新结构：独立搜索页，顶部大输入框 + 结果网格 + 「在当前榜单中筛选」提示，
 * 输入防抖 + 缓存（见 SearchBox）。
 */
export default function SearchView({ mode, onOpenSeries, favorites, onToggleFavorite }) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState(null)

  async function run(q, cached, meta) {
    const term = q.trim()
    if (!term) {
      // 清空输入：复位结果，不发起查询
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = cached ?? (await searchSeries(term, 'short', 1))
      setResults(list)
      setSearched(true)
    } catch (e) {
      setError(e.message ?? String(e))
      toast.push('搜索失败，请稍后重试', { tone: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>搜索</h1>
        <p className="page-sub">剧名、演员或题材都可以</p>
      </header>

      <div className="search-hero">
        <SearchBox
          value={query}
          onChange={setQuery}
          onSubmit={run}
          placeholder="输入剧名、演员或题材"
          autoFocus
        />
      </div>

      {loading && <p className="muted">搜索中…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && searched && results.length === 0 && (
        <div className="empty">
          <p>没有找到「{query}」相关的剧</p>
          <small>换个关键词，或到「探索片库」按题材浏览</small>
        </div>
      )}
      {!loading && results.length > 0 && (
        <>
          <p className="result-count">找到 {results.length} 个结果</p>
          <VirtualGrid
            items={results}
            minRowHeight={330}
            renderItem={(item) => (
              <SeriesCard
                key={item.id}
                item={item}
                onOpen={onOpenSeries}
                favorited={(favorites ?? []).some((f) => f.id === item.id)}
                onToggleFavorite={onToggleFavorite}
              />
            )}
          />
        </>
      )}
      {!loading && !searched && !error && (
        <div className="empty">
          <p>输入关键词开始搜索</p>
        </div>
      )}
    </div>
  )
}
