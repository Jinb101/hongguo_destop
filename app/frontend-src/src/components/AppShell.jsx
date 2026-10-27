import { useEffect, useMemo, useState } from 'react'
import TopBar from './TopBar.jsx'

/**
 * 应用外壳：顶栏 + 侧栏导航 + 内容区
 *
 * 布局改为 macOS 惯例：一条顶栏横跨整个窗口（交通灯在最左），
 * 侧栏从顶栏下方开始，内容区在右。
 *
 * PM 视角的信息架构（相对原版）：
 *
 *  1. 原版侧栏 8 个入口平铺、没有主次，导致「找剧」被拆成 3 个入口。
 *     新结构分两层：一级（首页/搜索/收藏/我的）+ 「更多」里的低频项。
 *  2. 原版顶栏同时出现「找剧 / 真人剧 / 漫剧」三个 tab，与侧栏语义重叠。
 *     新顶栏只保留剧场切换，并可整块关掉（顶栏自定义）。
 *  3. 剧目筛选下沉到内容区工具条，不与全局搜索混排。
 */

const TITLES = {
  home: '红果免费短剧',
  search: '搜索',
  rank: '排行榜',
  explore: '探索片库',
  favorites: '收藏',
  mine: '我的',
  account: '账号',
  offline: '离线',
  settings: '设置',
}

export default function AppShell({ active, onNavigate, children, mode, onModeChange }) {
  const [moreOpen, setMoreOpen] = useState(false)

  const PRIMARY = [
    { id: 'home', label: '首页', icon: 'home' },
    { id: 'search', label: '搜索', icon: 'search' },
    { id: 'favorites', label: '收藏', icon: 'bookmark' },
    { id: 'mine', label: '我的', icon: 'user' },
  ]
  const SECONDARY = [
    { id: 'rank', label: '排行榜', icon: 'trophy' },
    { id: 'explore', label: '探索片库', icon: 'compass' },
    { id: 'offline', label: '离线', icon: 'download' },
    { id: 'account', label: '账号', icon: 'shield' },
    { id: 'settings', label: '设置', icon: 'gear' },
  ]

  const secondaryActive = SECONDARY.some((s) => s.id === active)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const modes = useMemo(
    () => [
      { id: 'short_play', label: '真人剧' },
      { id: 'comic_series', label: '漫剧' },
      { id: 'ai_series', label: 'AI 剧' },
    ],
    [],
  )

  return (
    <div className="shell">
      <TopBar
        title={TITLES[active] ?? TITLES.home}
        mode={mode}
        modes={modes}
        onModeChange={onModeChange}
        onSearch={() => onNavigate?.('search')}
        onOpenAccount={() => onNavigate?.('account')}
      />

      <aside className="rail">
        <nav className="rail-nav" aria-label="主导航">
          {PRIMARY.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rail-item ${active === item.id ? 'is-active' : ''}`}
              onClick={() => {
                onNavigate?.(item.id)
                setMoreOpen(false)
              }}
              aria-current={active === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}

          <div className="rail-sep" role="presentation" />

          <button
            type="button"
            className={`rail-item ${secondaryActive ? 'is-active' : ''}`}
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
          >
            <Icon name="grid" />
            <span>更多</span>
            <Icon name="chevron" className="rail-chevron" />
          </button>
        </nav>

        {moreOpen && (
          <nav className="rail-more" aria-label="更多功能">
            {SECONDARY.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rail-item ${active === item.id ? 'is-active' : ''}`}
                onClick={() => {
                  onNavigate?.(item.id)
                  setMoreOpen(false)
                }}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        )}
      </aside>

      <div className="main">
        <main className="stage" id="stage">
          {children}
        </main>
      </div>
    </div>
  )
}

function Icon({ name, className = '' }) {
  const common = {
    className: `icon ${className}`,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
  const paths = {
    home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
    search: <><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
    trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4v1a3 3 0 0 0 3 3" /><path d="M17 6h3v1a3 3 0 0 1-3 3" /><path d="M12 14v4M8 21h8" /></>,
    compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
    download: <><path d="M12 3v11" /><path d="m7.5 10 4.5 4 4.5-4" /><path d="M4 19h16" /></>,
    shield: <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />,
    gear: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
  }
  return <svg {...common}>{paths[name] ?? null}</svg>
}
