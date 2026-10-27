import { useEffect, useState } from 'react'
import SmartCover from './SmartCover.jsx'
import { useResolvedCover } from '../lib/useResolvedCover.js'

/**
 * 剧目卡片
 *
 * 相对原版的调整：
 *  - 原版卡片下方信息为「剧名 + 播放量 + 题材」三行堆叠，
 *    且集数标签位置不统一。本次统一为：集数角标在封面右上，
 *    下方固定两行（剧名 + 元信息），超出用省略号，避免网格高度跳动。
 *  - 收藏按钮改为 hover 显现，减少静态视觉噪音，同时保留键盘可达。
 *  - 封面可能是 `guoban-cover:<id>` 占位协议（IPC 通道），
 *    需要异步换成真实图，这里做一次解析。
 */
export default function SeriesCard({ item, onOpen, onToggleFavorite, favorited, progress }) {
  const { cover } = useResolvedCover(item)
  const title = item?.title ?? '未命名'
  const episodes = item?.episodes ?? 0
  const hot = item?.hot ?? ''
  const genre = (item?.genres ?? [])[0] ?? ''

  return (
    <article className="card">
      <div className="card-media">
        <SmartCover
          src={cover}
          alt={title}
          width={item?.coverWidth ?? 640}
          height={item?.coverHeight ?? 914}
          onClick={() => onOpen?.(item)}
          badge={episodes ? <span className="badge-ep">全 {episodes} 集</span> : null}
        />
        {progress ? (
          <div className="card-progress" title={`已看 ${progress.ep ?? 1} 集`}>
            <div className="card-progress-bar" style={{ width: `${progress.percent ?? 0}%` }} />
          </div>
        ) : null}
        <button
          type="button"
          className={`card-fav ${favorited ? 'is-on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite?.(item)
          }}
          aria-label={favorited ? `取消收藏 ${title}` : `收藏 ${title}`}
          aria-pressed={favorited}
        >
          {favorited ? '★' : '☆'}
        </button>
      </div>

      <div className="card-body">
        <button type="button" className="card-title" onClick={() => onOpen?.(item)} title={title}>
          {title}
        </button>
        <div className="card-meta">
          {hot ? <span>{hot}</span> : null}
          {genre ? <span className="card-genre">{genre}</span> : null}
        </div>
      </div>
    </article>
  )
}
