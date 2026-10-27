import { useCallback, useEffect, useState } from 'react'
import { usePlayback } from '../lib/playback-context.jsx'
import { fetchRecommendations } from '../lib/playback.js'
import VideoSurface from '../components/VideoSurface.jsx'
import SwipeRecommend from '../components/SwipeRecommend.jsx'

/**
 * 播放页
 *
 * 相对原版的改进：
 *  - 原版把播放器放在详情 modal 里，用户看完一集后要关掉整个弹层再选下一集。
 *    新结构：播放页是独立视图，左侧剧集列表常驻，右侧播放器 + 快捷控制，
 *    切集不离开页面。
 *  - 新增「收起为小窗」：收起后回到列表继续浏览，视频不中断。
 *  - 新增「下一部看什么」竖向滑动推荐：上下滑动切换，点击看详情。
 *  - 播放源解析慢时给出明确的「解析中 / 失败可重试」状态。
 */
export default function PlayerView({ onBack, onOpenSeries, onPlaySeries }) {
  const {
    current,
    status,
    episodes,
    ep,
    minimize,
    changeEp,
    rate,
    setPlaybackRate,
    muted,
    toggleMuted,
    position,
    loadEpisodes,
  } = usePlayback()

  const [recommends, setRecommends] = useState([])
  const [recLoading, setRecLoading] = useState(true)

  // 载入剧集列表
  useEffect(() => {
    if (!current?.id) return
    loadEpisodes(current.id)
  }, [current?.id, loadEpisodes])

  // 载入推荐（排除当前剧）
  useEffect(() => {
    if (!current?.id) return undefined
    let alive = true
    setRecLoading(true)
    fetchRecommendations(current.id, 12)
      .then((list) => {
        if (alive) setRecommends(list)
      })
      .catch(() => {
        if (alive) setRecommends([])
      })
      .finally(() => {
        if (alive) setRecLoading(false)
      })
    return () => {
      alive = false
    }
  }, [current?.id])

  const handleSelect = useCallback(
    (item) => {
      onPlaySeries?.(item, 1)
    },
    [onPlaySeries],
  )

  if (!current) return null

  const total = episodes.length
  const hasPrev = ep > 1
  const hasNext = total > 0 && ep < total

  return (
    <div className="player-view">
      <div className="player-main">
        {/*
          播放页顶栏同样是窗口拖动区（与原版一致），
          按钮区域单独关掉，避免点按钮变成拖窗口。
        */}
        <header className="player-head" data-tauri-drag-region="deep" data-window-drag>
          <button
            type="button"
            className="btn-back"
            onClick={onBack}
            aria-label="返回"
            data-tauri-drag-region="false"
            data-window-drag="false"
          >
            ‹ 返回
          </button>
          <div className="player-title">
            <h1>{current.title}</h1>
            <span>
              第 {ep} 集{total ? ` / 共 ${total} 集` : ''}
              {current.copyright ? ` · ${current.copyright}` : ''}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost player-minimize"
            onClick={minimize}
            title="收起为小窗，继续浏览其他剧"
            data-tauri-drag-region="false"
            data-window-drag="false"
          >
            ▣ 收起小窗
          </button>
        </header>

        <div className="player-stage">
          <VideoSurface />
        </div>

        <div className="player-tools">
          <div className="speed-group" role="group" aria-label="播放速度">
            {[0.75, 1, 1.25, 1.5, 2].map((s) => (
              <button
                key={s}
                type="button"
                className={rate === s ? 'is-on' : ''}
                onClick={() => setPlaybackRate(s)}
              >
                {s}x
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost" onClick={toggleMuted}>
            {muted ? '取消静音' : '静音'}
          </button>
          {hasPrev && (
            <button type="button" className="btn-ghost" onClick={() => changeEp(ep - 1)}>
              上一集
            </button>
          )}
          {hasNext && (
            <button type="button" className="btn-ghost" onClick={() => changeEp(ep + 1)}>
              下一集
            </button>
          )}
          <span className="player-time">
            {formatTime(position)}
            {total ? ` / 进度 ${ep}/${total}` : ''}
          </span>
        </div>
      </div>

      <aside className="player-side">
        <div className="player-side-scroll">
          <SwipeRecommend
            items={recommends}
            loading={recLoading}
            title="下一部看什么"
            emptyText="暂时没有更多推荐"
            onOpen={onOpenSeries}
            onSelect={handleSelect}
          />

          <section className="player-episodes">
            <h3 className="player-side-title">剧集列表</h3>
            <div className="ep-list">
              {total === 0 && <p className="muted">正在加载剧集…</p>}
              {episodes.map((item) => (
                <button
                  key={item.ep}
                  type="button"
                  className={`ep-row ${current.ep === item.ep ? 'is-on' : ''}`}
                  onClick={() => changeEp(item.ep)}
                >
                  <span className="ep-row-no">{item.ep}</span>
                  <span className="ep-row-title">第 {item.ep} 集</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  )
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
