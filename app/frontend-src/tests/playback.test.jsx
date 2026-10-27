import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { normalizeEpisodes } from '../src/lib/playback.js'
import { localStore } from '../src/lib/ipc.js'
import ErrorBoundary from '../src/components/ErrorBoundary.jsx'
import SwipeRecommend from '../src/components/SwipeRecommend.jsx'

/* ------------------------------------------------------------------ *
 * episodes 归一化（曾导致整页崩溃的真实缺陷）
 * ------------------------------------------------------------------ */

describe('episodes 结构归一化', () => {
  it('数组形态正常返回', () => {
    const list = normalizeEpisodes({
      episodes: [{ index: '1', vid: 'v1' }, { index: '2', vid: 'v2' }],
    })
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ ep: 1, vid: 'v1' })
  })

  it('对象形态（集号为 key）也能归一化', () => {
    const list = normalizeEpisodes({
      episodes: { 1: { index: '1', vid: 'v1' }, 2: { index: '2', vid: 'v2' } },
    })
    expect(Array.isArray(list)).toBe(true)
    expect(list).toHaveLength(2)
  })

  it('缺字段时用下标兜底，且始终返回数组', () => {
    const list = normalizeEpisodes({ episodes: [{ vid: 'a' }, { vid: 'b' }] })
    expect(Array.isArray(list)).toBe(true)
    expect(list.map((e) => e.ep)).toEqual([1, 2])
  })

  it('响应为错误对象时也不会崩', () => {
    const list = normalizeEpisodes({ detail: { code: 'PLAY_FAILED' } })
    expect(Array.isArray(list)).toBe(true)
  })

  it('undefined 输入返回空数组', () => {
    expect(normalizeEpisodes(undefined)).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * localStorage 防御（曾因存储被污染导致 .filter 崩溃）
 * ------------------------------------------------------------------ */

describe('localStore 数组安全', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('存储内容是对象时降级为数组', () => {
    localStorage.setItem('hongguo:favorites', JSON.stringify({ oops: true }))
    expect(localStore.readList('favorites')).toEqual([])
  })

  it('存储内容是数组时原样返回', () => {
    localStorage.setItem('hongguo:favorites', JSON.stringify([{ series_id: 'a' }]))
    expect(localStore.readList('favorites')).toHaveLength(1)
  })

  it('损坏的 JSON 不抛异常', () => {
    localStorage.setItem('hongguo:history', '{not json')
    expect(localStore.readList('history')).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 错误边界
 * ------------------------------------------------------------------ */

describe('ErrorBoundary', () => {
  it('子组件抛错时显示降级界面而不是白屏', () => {
    const Boom = () => {
      throw new Error('boom')
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary label="test">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('这个页面出了点问题')).toBeTruthy()
    expect(screen.getByText(/boom/)).toBeTruthy()
    spy.mockRestore()
  })

  it('正常子组件不受影响', () => {
    render(
      <ErrorBoundary label="test">
        <div>正常内容</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('正常内容')).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ *
 * 竖向滑动推荐
 * ------------------------------------------------------------------ */

describe('SwipeRecommend', () => {
  const items = Array.from({ length: 5 }).map((_, i) => ({
    series_id: `s${i}`,
    title: `剧目 ${i + 1}`,
    cover: '',
    episode_cnt: 30 + i,
  }))

  beforeEach(() => {
    global.IntersectionObserver = class {
      constructor(cb) {
        this.cb = cb
      }
      observe() {}
      disconnect() {}
    }
  })

  it('渲染全部推荐项', () => {
    render(<SwipeRecommend items={items} />)
    expect(screen.getAllByRole('option')).toHaveLength(5)
  })

  it('点击推荐项触发 onOpen', () => {
    const onOpen = vi.fn()
    render(<SwipeRecommend items={items} onOpen={onOpen} />)
    fireEvent.click(screen.getAllByRole('option')[2])
    expect(onOpen).toHaveBeenCalledWith(items[2])
  })

  it('空列表时给出提示而不是空白', () => {
    render(<SwipeRecommend items={[]} emptyText="暂时没有更多推荐" />)
    expect(screen.getByText('暂时没有更多推荐')).toBeTruthy()
  })

  it('提示用户可用上下键切换', () => {
    render(<SwipeRecommend items={items} />)
    expect(screen.getByText(/滑动切换/)).toBeTruthy()
  })
})
