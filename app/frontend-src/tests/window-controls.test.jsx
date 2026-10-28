import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

/**
 * 无边框窗口的按钮
 *
 * 窗口是 decorations:false，最小化/最大化/关闭完全靠这三个按钮；
 * 任何一条 IPC 命令接错，窗口就关不掉或退不出最大化。
 */

const win = {
  isMaximized: vi.fn(async () => false),
  maximize: vi.fn(async () => {}),
  unmaximize: vi.fn(async () => {}),
  minimize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }))

// 预热：组件在点击时才动态 import，首个点击会落在模块加载上而不是断言上。
await import('@tauri-apps/api/window')

const { default: WindowControls } = await import('../src/components/WindowControls.jsx')

describe('WindowControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    win.isMaximized.mockResolvedValue(false)
    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }
  })

  it('未最大化时绿键走 maximize', async () => {
    const { container } = render(<WindowControls />)
    const green = container.querySelector('.traffic-btn.is-max')
    await waitFor(() => expect(win.isMaximized).toHaveBeenCalled())
    expect(green.getAttribute('aria-label')).toBe('最大化')

    fireEvent.click(green)
    await waitFor(() => expect(win.maximize).toHaveBeenCalled())
    expect(win.unmaximize).not.toHaveBeenCalled()
  })

  it('已最大化时绿键走 unmaximize', async () => {
    win.isMaximized.mockResolvedValue(true)
    const { container } = render(<WindowControls />)
    const green = container.querySelector('.traffic-btn.is-max')
    await waitFor(() => expect(green.getAttribute('aria-label')).toBe('还原'))

    fireEvent.click(green)
    await waitFor(() => expect(win.unmaximize).toHaveBeenCalled())
    expect(win.maximize).not.toHaveBeenCalled()
  })

  it('红黄键分别关闭与最小化', async () => {
    const { container } = render(<WindowControls />)
    // render 同一 tick 内的首个 fireEvent 会被 React 丢掉，先等一次副作用。
    await waitFor(() => expect(win.isMaximized).toHaveBeenCalled())

    fireEvent.click(container.querySelector('.traffic-btn.is-close'))
    await waitFor(() => expect(win.close).toHaveBeenCalled())

    fireEvent.click(container.querySelector('.traffic-btn.is-min'))
    await waitFor(() => expect(win.minimize).toHaveBeenCalled())
  })

  it('浏览器环境不渲染窗口按钮', () => {
    delete window.__TAURI_INTERNALS__
    const { container } = render(<WindowControls />)
    expect(container.querySelector('.traffic')).toBeNull()
  })

  it('macOS 用原生交通灯，不渲染自定义按钮', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      configurable: true,
    })
    try {
      const { container } = render(<WindowControls />)
      expect(container.querySelector('.traffic')).toBeNull()
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (jsdom)',
        configurable: true,
      })
    }
  })
})
