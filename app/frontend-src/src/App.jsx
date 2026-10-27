import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from './components/AppShell.jsx'
import DetailSheet from './components/DetailSheet.jsx'
import MiniPlayer from './components/MiniPlayer.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ToastProvider, useToast } from './components/Toast.jsx'
import { PlaybackProvider, usePlayback } from './lib/playback-context.jsx'
import { useWindowDrag } from './lib/window-drag.js'
import DiscoverView from './views/DiscoverView.jsx'
import SearchView from './views/SearchView.jsx'
import RankView from './views/RankView.jsx'
import ExploreView from './views/ExploreView.jsx'
import MineView from './views/MineView.jsx'
import SettingsView from './views/SettingsView.jsx'
import PlayerView from './views/PlayerView.jsx'
import {
  call,
  listFavorites,
  listHistory,
  removeHistory,
  setFavorite,
  setHistory,
} from './lib/ipc.js'
import { normalizeEpisodes } from './lib/playback.js'
import { restoreAlwaysOnTop } from './lib/window-prefs.js'

const VIEWS = [
  'home',
  'search',
  'rank',
  'explore',
  'favorites',
  'mine',
  'account',
  'offline',
  'settings',
]

function Shell() {
  const toast = useToast()
  const playback = usePlayback()
  // 启用窗口拖动（顶栏等标记了 data-window-drag 的区域可拖动窗口）
  useWindowDrag()
  const [view, setView] = useState('home')
  const [mode, setMode] = useState('short_play')
  const [favorites, setFavorites] = useState([])
  const [history, setHistory] = useState([])
  const [detail, setDetail] = useState(null)
  const [detailEpisodes, setDetailEpisodes] = useState([])

  // 启动即拉取本地库，避免进页面时空白闪烁
  useEffect(() => {
    Promise.all([listFavorites(), listHistory()])
      .then(([f, h]) => {
        setFavorites(Array.isArray(f) ? f : [])
        setHistory(Array.isArray(h) ? h : [])
      })
      .catch(() => {})
    // 恢复上次的窗口置顶状态（浏览器模式下是空操作）
    restoreAlwaysOnTop().catch(() => {})
  }, [])

  // 键盘快捷键：/ 聚焦搜索
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.key === '/' && !typing) {
        e.preventDefault()
        setView('search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navigate = useCallback((next) => {
    if (!VIEWS.includes(next)) return
    setView(next)
    document.getElementById('stage')?.scrollTo?.({ top: 0 })
  }, [])

  const openSeries = useCallback(async (item) => {
    setDetail(item)
    setDetailEpisodes([])
    try {
      const res = await call('get_validation_episodes', { seriesId: item.id })
      // 统一归一化：不同后端可能返回数组或以集号为 key 的对象
      setDetailEpisodes(normalizeEpisodes(res))
    } catch {
      setDetailEpisodes([])
    }
  }, [])

  const toggleFavorite = useCallback(
    async (item) => {
      const isFav = favorites.some((f) => f.id === item.id)
      try {
        await setFavorite(item, !isFav)
        /*
         * set_favorite 返回的是布尔值（是否成功），不是列表，
         * 所以这里重新拉一次收藏列表来刷新 UI 状态。
         */
        const list = await listFavorites()
        setFavorites(Array.isArray(list) ? list : favorites)
        toast.push(isFav ? '已取消收藏' : '已加入收藏')
      } catch (e) {
        toast.push(`收藏操作失败：${e.message ?? e}`, { tone: 'error' })
      }
    },
    [favorites, toast],
  )

  const handleRemoveHistory = useCallback(
    async (seriesId) => {
      try {
        await removeHistory(seriesId)
        // 与收藏同理：写命令的返回值不可靠，重新拉列表刷新状态
        const list = await listHistory()
        setHistory(Array.isArray(list) ? list : history)
        toast.push('已从历史移除')
      } catch (e) {
        toast.push(`移除失败：${e.message ?? e}`, { tone: 'error' })
      }
    },
    [history, toast],
  )

  /** 开始播放（进入全屏播放页）。 */
  const startPlayback = useCallback(
    async (item, ep = 1) => {
      setDetail(null)
      await playback.play(item, ep)
      try {
        await setHistory(item, ep)
        setHistory((prev) => {
          const list = Array.isArray(prev) ? prev : []
          return [{ ...item, ep, at: Date.now() }, ...list.filter((h) => h.id !== item.id)]
        })
      } catch {
        /* 进度记录失败不阻断播放 */
      }
    },
    [playback],
  )

  /** 从推荐列表直接换台播放。 */
  const switchSeries = useCallback(
    (item) => {
      startPlayback(item, 1)
    },
    [startPlayback],
  )

  const favProps = useMemo(
    () => ({ favorites, onToggleFavorite: toggleFavorite, onOpenSeries: openSeries }),
    [favorites, toggleFavorite, openSeries],
  )

  // 小窗模式下主界面照常显示，视频在悬浮窗继续播
  const showPlayer = playback.mode === 'full' && playback.current

  return (
    <>
      {showPlayer ? (
        <ErrorBoundary label="player" title="播放页出了点问题" onExit={() => playback.stop()}>
          <PlayerView
            onBack={() => playback.minimize()}
            onOpenSeries={openSeries}
            onPlaySeries={switchSeries}
          />
        </ErrorBoundary>
      ) : (
        <AppShell
          active={view}
          onNavigate={navigate}
          mode={mode}
          onModeChange={setMode}
        >
          <ErrorBoundary label="view" title="页面加载失败" onExit={() => navigate('home')}>
            {view === 'home' && <DiscoverView mode={mode} history={history} {...favProps} />}
            {view === 'search' && <SearchView mode={mode} {...favProps} />}
            {view === 'rank' && <RankView mode={mode} {...favProps} />}
            {view === 'explore' && <ExploreView mode={mode} {...favProps} />}
            {view === 'favorites' && (
              <MineView
                {...favProps}
                initialTab="favorites"
                history={history}
                onRemoveHistory={handleRemoveHistory}
                onNavigate={navigate}
              />
            )}
            {view === 'mine' && (
              <MineView
                {...favProps}
                initialTab="history"
                history={history}
                onRemoveHistory={handleRemoveHistory}
                onNavigate={navigate}
              />
            )}
            {view === 'account' && (
              <MineView
                {...favProps}
                initialTab="account"
                history={history}
                onRemoveHistory={handleRemoveHistory}
                onNavigate={navigate}
              />
            )}
            {view === 'offline' && (
              <MineView
                {...favProps}
                initialTab="offline"
                history={history}
                onRemoveHistory={handleRemoveHistory}
                onNavigate={navigate}
              />
            )}
            {view === 'settings' && <SettingsView />}
          </ErrorBoundary>

          <DetailSheet
            series={detail}
            episodes={detailEpisodes}
            onClose={() => setDetail(null)}
            onPlay={startPlayback}
            favorited={detail ? favorites.some((f) => f.id === detail.id) : false}
            onToggleFavorite={toggleFavorite}
          />
        </AppShell>
      )}

      {/* 小窗悬浮播放器：任何界面下都可存在 */}
      <MiniPlayer />
    </>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <PlaybackProvider>
        <Shell />
      </PlaybackProvider>
    </ToastProvider>
  )
}
