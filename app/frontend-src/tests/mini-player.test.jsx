import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// jsdom 没有 PointerEvent，用 MouseEvent 兼容实现补上，否则拖动坐标会丢
if (typeof window.PointerEvent !== 'function') {
  class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
    }
  }
  window.PointerEvent = PointerEvent
}

const playback = {
  mode: 'mini',
  current: { title: '测试短剧', seriesId: 1 },
  status: 'playing',
  expand: vi.fn(),
  stop: vi.fn(),
}

vi.mock('../src/lib/playback-context.jsx', () => ({
  usePlayback: () => playback,
}))

vi.mock('../src/components/VideoSurface.jsx', () => ({
  default: ({ className }) => <div data-testid="surface" className={className} />,
}))

const { default: MiniPlayer } = await import('../src/components/MiniPlayer.jsx')

describe('MiniPlayer 悬浮小窗', () => {
  beforeEach(() => {
    localStorage.clear()
    playback.mode = 'mini'
    playback.current = { title: '测试短剧', seriesId: 1 }
    playback.expand.mockClear()
    playback.stop.mockClear()
  })

  it('只在小窗模式下渲染', () => {
    playback.mode = 'full'
    const { container } = render(<MiniPlayer />)
    expect(container.querySelector('.miniplayer')).toBeNull()

    playback.mode = 'mini'
    render(<MiniPlayer />)
    expect(document.querySelector('.miniplayer')).not.toBeNull()
  })

  it('收起后隐藏播放画面，展开恢复', () => {
    render(<MiniPlayer />)
    const toggle = screen.getByLabelText('收起小窗')
    fireEvent.click(toggle)
    expect(document.querySelector('.miniplayer').classList.contains('is-collapsed')).toBe(true)
    expect(screen.queryByTestId('surface')).toBeNull()

    fireEvent.click(screen.getByLabelText('展开小窗'))
    expect(screen.getByTestId('surface').className).toBe('is-mini')
  })

  it('加宽状态会记到本地并体现在 class 上', () => {
    render(<MiniPlayer />)
    fireEvent.click(screen.getByLabelText('加宽窗口'))
    expect(document.querySelector('.miniplayer').classList.contains('is-wide')).toBe(true)
    expect(localStorage.getItem('hongguo:mini-player-wide')).toBe('1')
  })

  it('拖动松手后吸附到左边缘', () => {
    render(<MiniPlayer />)
    const bar = document.querySelector('.miniplayer-bar')
    fireEvent.pointerDown(bar, { button: 0, clientX: 630, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(bar, { clientX: 30, clientY: 320, pointerId: 1 })
    fireEvent.pointerUp(bar, { pointerId: 1 })

    const host = document.querySelector('.miniplayer')
    expect(host.style.left).toBe('16px')
    expect(JSON.parse(localStorage.getItem('hongguo:mini-player-pos')).x).toBe(16)
  })

  it('回到播放页与关闭分别调用 expand / stop', () => {
    render(<MiniPlayer />)
    fireEvent.click(screen.getByLabelText('展开为全屏播放'))
    expect(playback.expand).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('关闭播放'))
    expect(playback.stop).toHaveBeenCalledTimes(1)
  })
})
