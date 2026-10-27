import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

import { call, setFavorite } from '../src/lib/ipc.js'
import SmartCover from '../src/components/SmartCover.jsx'
import SearchBox from '../src/components/SearchBox.jsx'
import AppShell from '../src/components/AppShell.jsx'
import DetailSheet from '../src/components/DetailSheet.jsx'

/** 顶栏会在挂载后异步载入本机账号，测试里显式等它落定，避免 act 警告。 */
async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/* ------------------------------------------------------------------ *
 * IPC 层：请求治理
 * ------------------------------------------------------------------ */

describe('ipc 层请求治理', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ ok: true }),
      json: async () => ({ ok: true }),
    }))
  })

  it('相同 key 的并发请求只打一次后端', async () => {
    const [a, b] = await Promise.all([
      call('get_rank', { rankType: 'hot' }),
      call('get_rank', { rankType: 'hot' }),
    ])
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })

  it('不同 key 不被合并', async () => {
    await Promise.all([
      call('get_rank', { rankType: 'hot' }),
      call('get_rank', { rankType: 'new' }),
    ])
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('并发被闸门限制在 6 以内', async () => {
    let active = 0
    let peak = 0
    global.fetch = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 10))
      active -= 1
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '{}',
        json: async () => ({}),
      }
    })
    await Promise.all(
      Array.from({ length: 20 }).map((_, i) => call('get_rank', { rankType: `b${i}` })),
    )
    expect(peak).toBeLessThanOrEqual(6)
  })

  it('请求失败时 reject 而非静默吞掉', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500 }))
    await expect(call('get_rank', { rankType: 'hot' })).rejects.toBeTruthy()
  })

  it('路由表里没有的命令给出明确错误', async () => {
    await expect(call('no_such_command', {})).rejects.toThrow(/未知命令/)
  })

  it('收藏走本机状态库，写入后直接返回新列表', async () => {
    const next = await setFavorite({ id: 'a', title: '剧A' }, true)
    expect(next.map((x) => x.id)).toEqual(['a'])
    await setFavorite({ id: 'b', title: '剧B' }, true)
    const removed = await setFavorite({ id: 'a', title: '剧A' }, false)
    expect(removed.map((x) => x.id)).toEqual(['b'])
  })
})

/* ------------------------------------------------------------------ *
 * SmartCover：懒加载
 * ------------------------------------------------------------------ */

describe('SmartCover 懒加载', () => {
  beforeEach(() => {
    global.IntersectionObserver = class {
      constructor(cb) {
        this.cb = cb
      }
      observe(el) {
        this.el = el
      }
      disconnect() {}
      trigger() {
        this.cb([{ isIntersecting: true, target: this.el }])
      }
    }
  })

  it('未进入视口时不挂载 src', () => {
    render(<SmartCover src="data:image/png;base64,AAA" alt="封面" />)
    const img = document.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBeNull()
    expect(img.getAttribute('loading')).toBe('lazy')
  })

  it('预留宽高比避免布局跳动', () => {
    const { container } = render(<SmartCover src="x" width={640} height={914} alt="c" />)
    expect(container.querySelector('.cover').style.aspectRatio).toBe('640 / 914')
  })

  it('eager 模式立即挂载 src（首屏关键图）', () => {
    render(<SmartCover src="data:image/png;base64,AAA" alt="封面" eager />)
    const img = document.querySelector('img')
    expect(img.getAttribute('src')).toBeTruthy()
    expect(img.getAttribute('loading')).toBe('eager')
  })
})

/* ------------------------------------------------------------------ *
 * SearchBox：防抖
 * ------------------------------------------------------------------ */

describe('SearchBox 输入防抖', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('连续输入只在停顿后触发一次提交', () => {
    const onSubmit = vi.fn()
    render(<SearchBox onSubmit={onSubmit} />)
    const input = screen.getByLabelText('搜索短剧或演员')

    fireEvent.change(input, { target: { value: '王' } })
    fireEvent.change(input, { target: { value: '王后' } })
    fireEvent.change(input, { target: { value: '王后归' } })

    expect(onSubmit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('王后归', null, expect.anything())
  })

  it('空输入不发起查询，仅通知已清空', () => {
    const onSubmit = vi.fn()
    render(<SearchBox onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('搜索短剧或演员'), { target: { value: '  ' } })
    vi.advanceTimersByTime(300)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toBe('')
    expect(onSubmit.mock.calls[0][2]).toMatchObject({ cleared: true })
  })

  it('回车立即提交，不等防抖', () => {
    const onSubmit = vi.fn()
    render(<SearchBox onSubmit={onSubmit} />)
    const input = screen.getByLabelText('搜索短剧或演员')
    fireEvent.change(input, { target: { value: '长安' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

/* ------------------------------------------------------------------ *
 * AppShell：信息架构
 * ------------------------------------------------------------------ */

describe('AppShell 导航结构', () => {
  it('一级导航只有 4 项，低频功能收进「更多」', async () => {
    render(
      <AppShell nav active="home" onNavigate={() => {}}>
        <div>内容</div>
      </AppShell>,
    )
    await flushAsync()
    const primary = screen.getByLabelText('主导航')
    expect(primary.querySelectorAll('.rail-item')).toHaveLength(5) // 4 个一级 + 「更多」
    expect(screen.queryByText('排行榜')).toBeNull()
  })

  it('点击「更多」后展开低频入口', async () => {
    render(
      <AppShell nav active="home" onNavigate={() => {}}>
        <div>内容</div>
      </AppShell>,
    )
    await flushAsync()
    fireEvent.click(screen.getByText('更多'))
    expect(screen.getByText('排行榜')).toBeTruthy()
    expect(screen.getByText('探索片库')).toBeTruthy()
  })

  it('剧场模式切换在顶栏，与侧栏不重复', async () => {
    render(
      <AppShell nav active="home" onNavigate={() => {}}>
        <div>内容</div>
      </AppShell>,
    )
    await flushAsync()
    const mode = screen.getByLabelText('剧场模式')
    expect(mode.querySelectorAll('[role="tab"]')).toHaveLength(3)
  })
})

/* ------------------------------------------------------------------ *
 * DetailSheet：抽屉行为
 * ------------------------------------------------------------------ */

describe('DetailSheet 抽屉', () => {
  it('按 ESC 关闭', () => {
    const onClose = vi.fn()
    render(<DetailSheet series={{ series_id: 's1', title: '夜色渐浓' }} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('未选中剧目时不渲染', () => {
    const { container } = render(<DetailSheet series={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('提供立即播放入口与选集列表', () => {
    render(
      <DetailSheet
        series={{ series_id: 's1', title: '夜色渐浓' }}
        episodes={[{ ep: 1 }, { ep: 2 }]}
        onPlay={() => {}}
      />,
    )
    expect(screen.getByText('立即播放')).toBeTruthy()
    expect(screen.getAllByText(/第 \d 集/).length).toBe(2)
  })
})
