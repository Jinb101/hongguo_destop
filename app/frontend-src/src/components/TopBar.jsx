import { useCallback, useEffect, useRef, useState } from 'react'
import WindowControls from './WindowControls.jsx'
import { avatarHue, useAccount } from '../lib/account.js'
import { THEMES, useTheme } from '../lib/theme.js'

/**
 * 顶栏（macOS 布局，可自定义）
 *
 * 结构：交通灯 + 品牌/页名 ｜ 剧场切换 ｜ 时钟 · 搜索 · 外观 · 顶栏设置 · 头像
 *
 * 「自定义」体现在两处：
 *   1. 剧场切换 / 搜索入口 / 时钟 可以单独关掉，偏好落 localStorage；
 *   2. 外观（玻璃 / 羊皮卷）在这里一键切换，点击处以圆形扩散过渡。
 * 整条顶栏是窗口拖动区，交互元素显式排除，否则输入框里按下鼠标会变成拖窗口。
 */

const PREFS_KEY = 'hongguo:header'

export const HEADER_ITEMS = [
  { id: 'modes', label: '剧场切换', hint: '真人剧 / 漫剧 / AI 剧' },
  { id: 'search', label: '搜索入口', hint: '顶栏右侧的搜索按钮' },
  { id: 'clock', label: '时钟', hint: '显示当前时间' },
]

const DEFAULT_PREFS = { modes: true, search: true, clock: false }

export function readHeaderPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFS
    return {
      modes: parsed.modes !== false,
      search: parsed.search !== false,
      clock: parsed.clock === true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function writeHeaderPrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* 忽略写入失败，本次会话内仍然生效 */
  }
}

function formatClock(date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function TopBar({ title, mode, modes, onModeChange, onSearch, onOpenAccount }) {
  const { theme, choose } = useTheme()
  const { profile } = useAccount()
  const [prefs, setPrefs] = useState(readHeaderPrefs)
  const [menuOpen, setMenuOpen] = useState(false)
  const [clock, setClock] = useState(() => formatClock(new Date()))
  const rightRef = useRef(null)

  useEffect(() => {
    writeHeaderPrefs(prefs)
  }, [prefs])

  useEffect(() => {
    if (!prefs.clock) return undefined
    setClock(formatClock(new Date()))
    const timer = setInterval(() => setClock(formatClock(new Date())), 15000)
    return () => clearInterval(timer)
  }, [prefs.clock])

  useEffect(() => {
    if (!menuOpen) return undefined
    const onDown = (e) => {
      if (!rightRef.current?.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const togglePref = useCallback((id) => {
    setPrefs((p) => ({ ...p, [id]: !p[id] }))
  }, [])

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]
  const other = THEMES.find((t) => t.id !== theme) ?? THEMES[0]
  const nickname = profile?.nickname ?? '本机观众'

  return (
    <header className="topbar" data-tauri-drag-region="deep" data-window-drag>
      <div className="topbar-left">
        <WindowControls />
        <span className="topbar-brand">
          <svg className="topbar-logo" viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <radialGradient id="hgMarkFruit" cx="24" cy="26" r="30" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#ff8a64" />
                <stop offset="0.5" stopColor="#f43a41" />
                <stop offset="1" stopColor="#a90d29" />
              </radialGradient>
              <linearGradient id="hgMarkLeaf" x1="38" y1="20" x2="54" y2="8" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#96e880" />
                <stop offset="1" stopColor="#2b8f4e" />
              </linearGradient>
            </defs>
            <path d="M34 17c-1-5 0-8 2-10" fill="none" stroke="#8d5c2f" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M36 18c4-6 11-10 19-12 1 7-3 14-10 17-4 2-9 0-9-5z" fill="url(#hgMarkLeaf)" />
            <path d="M32 16c-5-3-12-1-15 5-4 7-2 17 5 23 4 3 9 4 13 2 7-4 11-11 10-19-1-7-7-12-13-11z" fill="url(#hgMarkFruit)" />
            <path d="M31 27 41 34 31 41z" fill="#fff8ec" stroke="#fff8ec" strokeWidth="3.4" strokeLinejoin="round" />
          </svg>
          <span className="topbar-title" title={title}>
            {title}
          </span>
        </span>
      </div>

      <div className="topbar-center">
        {prefs.modes && (
          <div
            className="bar-mode"
            role="tablist"
            aria-label="剧场模式"
            data-tauri-drag-region="false"
            data-window-drag="false"
          >
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                className={`bar-mode-item ${mode === m.id ? 'is-active' : ''}`}
                onClick={() => onModeChange?.(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className="topbar-right"
        ref={rightRef}
        data-tauri-drag-region="false"
        data-window-drag="false"
      >
        {prefs.clock && (
          <span className="topbar-clock" aria-label="当前时间">
            {clock}
          </span>
        )}

        {prefs.search && (
          <button type="button" className="topbar-btn topbar-search" onClick={onSearch} title="搜索剧名">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m16.5 16.5 4 4" />
            </svg>
            <span>搜索</span>
            <kbd className="topbar-kbd">/</kbd>
          </button>
        )}

        <button
          type="button"
          className={`theme-switch is-${theme}`}
          onClick={(e) => choose(other.id, e)}
          title={`当前：${current.label} · 点击切换为${other.label}`}
          aria-label={`当前外观${current.label}，点击切换为${other.label}`}
        >
          <span className="theme-swatch" aria-hidden="true" />
          <span className="theme-label">{current.label}</span>
        </button>

        <button
          type="button"
          className={`topbar-btn ${menuOpen ? 'is-on' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="自定义顶栏"
          aria-expanded={menuOpen}
          title="自定义顶栏"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>

        <button
          type="button"
          className="topbar-avatar"
          style={{ '--avatar-hue': avatarHue(profile) }}
          onClick={onOpenAccount}
          title={`本机账号：${nickname}`}
          aria-label={`打开本机账号 ${nickname}`}
        >
          {Array.from(nickname)[0] ?? '红'}
        </button>

        {menuOpen && (
          <div className="hdr-menu" role="dialog" aria-label="自定义顶栏">
            <p className="hdr-menu-title">顶栏显示</p>
            {HEADER_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="switch"
                aria-checked={Boolean(prefs[item.id])}
                className="hdr-menu-row"
                onClick={() => togglePref(item.id)}
              >
                <span className="hdr-menu-text">
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </span>
                <span className={`mini-switch ${prefs[item.id] ? 'is-on' : ''}`} aria-hidden="true" />
              </button>
            ))}

            <div className="hdr-menu-sep" role="presentation" />

            <p className="hdr-menu-title">外观</p>
            <div className="hdr-themes">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`hdr-theme is-${t.id} ${theme === t.id ? 'is-active' : ''}`}
                  onClick={(e) => {
                    choose(t.id, e)
                    setMenuOpen(false)
                  }}
                >
                  <span className="hdr-theme-swatch" aria-hidden="true" />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
