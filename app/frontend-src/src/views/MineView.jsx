import { useEffect, useMemo, useState } from 'react'
import SeriesCard from '../components/SeriesCard.jsx'
import SearchBox from '../components/SearchBox.jsx'
import PhoneLoginPanel from '../components/PhoneLoginPanel.jsx'
import { avatarHue, useAccount } from '../lib/account.js'

/**
 * 我的
 *
 * PM 视角重排：原版把「收藏 / 历史 / 离线 / 账号」做成侧栏四个平级入口，
 * 其中「收藏」内部还有 4 个子 tab（桌面收藏/桌面历史/手机片单/离线文件），
 * 形成两级侧栏 + 三级 tab 的嵌套，用户很容易迷路。
 *
 * 新结构：「我的」是唯一入口页，内部用横向分段控件组织，
 * 一屏可见全部四类内容，切换不再改变整体布局上下文。
 */
export default function MineView(props) {
  const {
    onOpenSeries,
    onToggleFavorite,
    onRemoveHistory,
    onNavigate,
    initialTab = 'favorites',
  } = props
  // 防御：上游数据可能不是数组，直接 filter 会把整个视图打崩
  const favorites = Array.isArray(props.favorites) ? props.favorites : []
  const history = Array.isArray(props.history) ? props.history : []

  const [tab, setTab] = useState(initialTab)
  const [query, setQuery] = useState('')

  // 从别处跳进来时切到对应分段
  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  const filteredFav = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return favorites
    return favorites.filter((f) => (f.title ?? f.name ?? '').toLowerCase().includes(q))
  }, [favorites, query])

  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return history
    return history.filter((f) => (f.title ?? f.name ?? '').toLowerCase().includes(q))
  }, [history, query])

  const TABS = [
    { id: 'favorites', label: '收藏', count: favorites.length },
    { id: 'history', label: '观看历史', count: history.length },
    { id: 'offline', label: '离线下载', count: null },
    { id: 'account', label: '账号', count: null },
  ]

  return (
    <div className="page">
      <header className="page-head">
        <h1>我的</h1>
        <p className="page-sub">收藏、历史、离线与账号都收在这里</p>
      </header>

      <div className="segment" role="tablist" aria-label="我的内容分类">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`segment-item ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count !== null && t.count > 0 && <span className="segment-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'favorites' && (
        <section className="block">
          <div className="toolbar">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="搜索收藏的剧名"
              compact
            />
          </div>
          {filteredFav.length ? (
            <div className="rail-cards wrap">
              {filteredFav.map((item) => (
                <SeriesCard
                  key={item.id}
                  item={item}
                  onOpen={onOpenSeries}
                  favorited
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          ) : (
            <Empty
              text={query ? '没有匹配的收藏' : '还没有收藏，看到喜欢的剧点右上角星标'}
              action={{ label: '去发现好剧', onClick: () => onNavigate?.('home') }}
            />
          )}
        </section>
      )}

      {tab === 'history' && (
        <section className="block">
          <div className="toolbar">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="搜索历史记录"
              compact
            />
          </div>
          {filteredHistory.length ? (
            <ul className="hist-list">
              {filteredHistory.map((item) => (
                <li key={item.id} className="hist">
                  <button type="button" className="hist-main" onClick={() => onOpenSeries(item)}>
                    <span className="hist-title">{item.title ?? item.name}</span>
                    <span className="hist-meta">
                      看到第 {item.ep ?? 1} 集
                      {item.at ? ` · ${formatWhen(item.at)}` : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="hist-remove"
                    onClick={() => onRemoveHistory?.(item.id)}
                    aria-label={`从历史移除 ${item.title ?? item.name}`}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="还没有观看记录" />
          )}
        </section>
      )}

      {tab === 'offline' && (
        <Empty
          text="暂无离线内容。到剧目详情里点「保存到离线」即可下载。"
          action={{ label: '去发现好剧', onClick: () => onNavigate?.('home') }}
        />
      )}

      {tab === 'account' && <AccountPanel />}
    </div>
  )
}

/**
 * 账号面板
 *
 * 本机账号是「持久登录」在无签名服务时的落地形态：
 * 身份、昵称、加入时间写进 state.json，重启后原样恢复。
 * 红果云端账号（手机号登录）仍需要签名服务，这里如实标注，
 * 不把本机档案包装成云端登录。
 */
function AccountPanel() {
  const { profile, rename, reset } = useAccount()
  const [name, setName] = useState(profile?.nickname ?? '')
  const [busy, setBusy] = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const nick = profile?.nickname ?? '本机观众'

  useEffect(() => {
    setName(profile?.nickname ?? '')
  }, [profile?.nickname])

  const save = async () => {
    const next = name.trim()
    if (!next || next === nick) return
    setBusy('rename')
    try {
      await rename(next)
    } finally {
      setBusy(null)
    }
  }

  const doReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setBusy('reset')
    try {
      await reset()
      setConfirmReset(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel account-panel">
      <h2>账号</h2>

      <div className="acct">
        <div className="acct-card">
          <span className="acct-avatar" style={{ '--avatar-hue': avatarHue(profile) }} aria-hidden="true">
            {Array.from(nick)[0] ?? '红'}
          </span>
          <div className="acct-id">
            <div className="acct-name-row">
              <span className="acct-name">{nick}</span>
              <span className="acct-badge">本机账号</span>
            </div>
            <span className="acct-meta">
              已持久登录 · 无需联网验证，重启后自动恢复
            </span>
          </div>
        </div>

        <div className="acct-rename">
          <input
            aria-label="昵称"
            value={name}
            maxLength={16}
            placeholder="给自己起个名字"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || !name.trim() || name.trim() === nick}
            onClick={save}
          >
            {busy === 'rename' ? '保存中…' : '保存昵称'}
          </button>
        </div>

        <dl className="acct-facts">
          <div className="acct-fact">
            <dt>本机身份</dt>
            <dd>{profile?.guestId ? profile.guestId.slice(0, 10) : '生成中…'}</dd>
          </div>
          <div className="acct-fact">
            <dt>加入时间</dt>
            <dd>{profile?.createdAt ? formatDay(profile.createdAt) : '—'}</dd>
          </div>
          <div className="acct-fact">
            <dt>启动次数</dt>
            <dd>{profile?.visits ?? '—'}</dd>
          </div>
          <div className="acct-fact">
            <dt>最近打开</dt>
            <dd>{profile?.lastActiveAt ? formatDay(profile.lastActiveAt) : '—'}</dd>
          </div>
        </dl>

        <p className="acct-note">
          身份与昵称保存在本机应用数据目录（state.json），收藏与历史也一并落盘。
          清空应用数据或更换电脑后会生成新身份，本机数据不会随账号迁移。
        </p>

        <div className="acct-sep" role="presentation" />

        <div className="acct-rename">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy !== null}
            onClick={doReset}
            onBlur={() => setConfirmReset(false)}
          >
            {busy === 'reset'
              ? '重置中…'
              : confirmReset
                ? '再点一次确认退出本机账号'
                : '退出本机账号'}
          </button>
        </div>

        <p className="acct-note">
          红果云端账号用手机号 + 短信验证码登录；请求签名由本机账号服务完成，
          登录状态只保存在本机。
        </p>

        <PhoneLoginPanel />
      </div>
    </div>
  )
}

function formatDay(ts) {
  try {
    return new Date(ts).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

function Empty({ text, action }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {action ? '☆' : '·'}
      </div>
      <p>{text}</p>
      {action && (
        <button type="button" className="btn btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}

function formatWhen(ts) {
  const d = new Date(ts)
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
