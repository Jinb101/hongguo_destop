import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchCover, fetchNewReleases, fetchRank } from '../lib/ipc.js'
import SeriesCard from '../components/SeriesCard.jsx'
import VirtualGrid from '../components/VirtualGrid.jsx'
import { useToast } from '../components/Toast.jsx'

/**
 * 首页（发现）
 *
 * PM 视角重排后的首页只做一件事：让用户尽快开始看片。
 * 原来首页是「今日片单 + 为你推荐 + 个性化推荐」三段并列的大杂烩，
 * 用户需要自己判断从哪看。新结构改成明确的优先级：
 *   1. 继续观看（若有历史，置顶，最强回访钩子）
 *   2. 今日上新（时效性内容）
 *   3. 猜你喜欢（长尾内容）
 * 并把三段收敛为「一个主推 + 两个横向频道」，降低首屏认知负担。
 */
export default function DiscoverView({ mode, onOpenSeries, favorites, onToggleFavorite, history }) {
  const toast = useToast()
  const [today, setToday] = useState([])
  const [recommended, setRecommended] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        // 两个请求并发但由 ipc 层统一闸门控制，不会同时打爆上游。
        // 任一失败不影响另一个（allSettled），两个都失败才算真错误。
        const [rankRes, newRes] = await Promise.allSettled([
          fetchRank('hot', 1, mode),
          fetchNewReleases(mode),
        ])

        if (!alive) return

        const ranked = rankRes.status === 'fulfilled' ? rankRes.value : []
        const fresh = newRes.status === 'fulfilled' ? newRes.value : []

        setToday(fresh.length ? fresh : ranked)
        setRecommended(ranked)

        if (rankRes.status === 'rejected' && newRes.status === 'rejected') {
          throw rankRes.reason
        }
      } catch (e) {
        if (alive) setError(e.message ?? String(e))
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [mode])

  const favIds = useMemo(
    () => new Set((favorites ?? []).map((f) => f.id)),
    [favorites],
  )

  const continueList = useMemo(() => {
    if (!Array.isArray(history) || !history.length) return []
    return history.slice(0, 6).map((h) => {
      // 历史记录里的集数字段是 lastEpisode（IPC 通道）
      const ep = h.lastEpisode || h.ep || 1
      const total = h.episodes || h.episodeCount || 0
      return {
        ...h,
        progress: {
          ep,
          percent: total ? Math.min(100, (ep / total) * 100) : 0,
        },
      }
    })
  }, [history])

  const renderCard = useCallback(
    (item) => (
      <SeriesCard
        key={item.id}
        item={item}
        onOpen={onOpenSeries}
        favorited={favIds.has(item.id)}
        onToggleFavorite={onToggleFavorite}
      />
    ),
    [favIds, onOpenSeries, onToggleFavorite],
  )

  if (loading) {
    return (
      <div className="page">
        <SectionSkeleton title="正在为你准备今日片单" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">!</div>
          <h2>加载失败</h2>
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      {continueList.length > 0 && (
        <section className="block">
          <header className="block-head">
            <h2>继续观看</h2>
            <span className="block-sub">接着上次的进度</span>
          </header>
          <div className="rail-cards">
            {continueList.map((item) => (
              <SeriesCard
                key={`c-${item.id}`}
                item={item}
                progress={item.progress}
                onOpen={onOpenSeries}
                favorited={favIds.has(item.id)}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <header className="block-head">
          <h2>{mode === 'short_play' ? '今日上新' : '最新上架'}</h2>
          <span className="block-sub">每天都有新剧</span>
        </header>
        {today.length ? (
          <VirtualGrid
            items={today}
            renderItem={renderCard}
            emptyState={<Empty text="今天还没有新剧，换个剧场看看" />}
          />
        ) : (
          <Empty text="今天还没有新剧，换个剧场看看" />
        )}
      </section>

      <section className="block">
        <header className="block-head">
          <h2>猜你喜欢</h2>
          <span className="block-sub">根据你的口味推荐</span>
        </header>
        {recommended.length ? (
          <div className="rail-cards">
            {recommended.slice(0, 12).map(renderCard)}
          </div>
        ) : (
          <Empty text="还没有足够口味数据" />
        )}
      </section>
    </div>
  )
}

function normalize(res) {
  if (!res) return []
  if (Array.isArray(res)) return res
  const list = res.items ?? res.results
  return Array.isArray(list) ? list : []
}

function Empty({ text }) {
  return (
    <div className="empty empty-inline">
      <p>{text}</p>
    </div>
  )
}

function SectionSkeleton({ title }) {
  return (
    <section className="block">
      <header className="block-head">
        <h2>{title}</h2>
      </header>
      <div className="rail-cards">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card">
            <div className="skeleton" style={{ aspectRatio: '640 / 914' }} />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </div>
        ))}
      </div>
    </section>
  )
}
