import { useEffect, useState } from 'react'
import { isTauri } from '../lib/ipc.js'
import { isMacPlatform } from '../lib/window-prefs.js'

/**
 * macOS 交通灯式窗口按钮（仅 Windows 需要）。
 *
 * Windows 侧主窗口是 decorations:false（无边框），最小化/最大化/关闭必须由前端提供，
 * 否则窗口关不掉。按钮默认只显示颜色，悬停整组时浮出符号 —— 与 macOS 一致。
 *
 * macOS 用原生装饰（titleBarStyle: Overlay）：交通灯和窗口拖动都归系统管，
 * 这里再画一套会和原生按钮重叠，所以直接不渲染。
 * 浏览器调试环境下同样不渲染。
 */
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const active = isTauri() && !isMacPlatform()

  useEffect(() => {
    if (!active) return undefined
    let disposed = false
    let unlisten = null

    // 静态 import 会让浏览器模式也加载 Tauri API，这里按需动态取。
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        if (disposed) return null
        const win = getCurrentWindow()
        const sync = () =>
          win
            .isMaximized()
            .then((v) => !disposed && setMaximized(v))
            .catch(() => {})
        sync()
        return win.listen('tauri://resize', sync).then((fn) => {
          if (disposed) fn()
          else unlisten = fn
        })
      })
      .catch(() => {})

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [active])

  if (!active) return null

  const act = (method) => () => {
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow()[method]())
      .catch(() => {})
  }

  return (
    <div
      className="traffic"
      data-window-drag="false"
      data-tauri-drag-region="false"
      role="group"
      aria-label="窗口控制"
    >
      <button
        type="button"
        className="traffic-btn is-close"
        onClick={act('close')}
        title="关闭"
        aria-label="关闭"
      >
        <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">
          <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="traffic-btn is-min"
        onClick={act('minimize')}
        title="最小化"
        aria-label="最小化"
      >
        <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">
          <path d="M2.5 5h5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="traffic-btn is-max"
        onClick={act(maximized ? 'unmaximize' : 'maximize')}
        title={maximized ? '还原' : '最大化'}
        aria-label={maximized ? '还原' : '最大化'}
      >
        <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">
          {maximized ? (
            <path d="M6.4 3.6H3.6v2.8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          ) : (
            <path d="M5 2.6v4.8M2.6 5h4.8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          )}
        </svg>
      </button>
    </div>
  )
}
