import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

import { useWindowDrag } from '../src/lib/window-drag.js'

/**
 * 窗口拖动
 *
 * 背景：这个功能踩过一个很隐蔽的坑 ——
 * Tauri 内置的 drag-region 脚本在 capture 阶段处理 pointerdown，
 * 如果自己的监听器挂在冒泡阶段，就永远收不到事件（拖不动）。
 * 下面的用例把「必须在 capture 阶段」这条约束固定下来。
 */

// jsdom 没有 PointerEvent，用 MouseEvent 近似
class PointerEventPolyfill extends MouseEvent {
  constructor(type, init = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'mouse'
    this.isPrimary = init.isPrimary ?? true
  }
}

describe('useWindowDrag', () => {
  let invokeSpy

  beforeEach(() => {
    global.PointerEvent = PointerEventPolyfill
    invokeSpy = vi.fn(async () => null)
    window.__TAURI_INTERNALS__ = { invoke: invokeSpy }
  })

  function Probe({ children }) {
    useWindowDrag()
    return children ?? null
  }

  it('在拖动区内按下时调用 start_dragging', () => {
    const { container } = render(
      <Probe>
        <div data-window-drag data-testid="bar">
          <span data-testid="label">空白</span>
        </div>
      </Probe>,
    )
    container
      .querySelector('[data-testid="label"]')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
    expect(invokeSpy).toHaveBeenCalledWith('plugin:window|start_dragging')
  })

  it('在拖动区外按下时不调用', () => {
    const { container } = render(
      <Probe>
        <div data-window-drag>
          <span data-testid="inside">内</span>
        </div>
        <div data-testid="outside">外</div>
      </Probe>,
    )
    container
      .querySelector('[data-testid="outside"]')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  it('显式排除的元素（data-window-drag="false"）不触发', () => {
    const { container } = render(
      <Probe>
        <div data-window-drag>
          <button type="button" data-window-drag="false" data-testid="btn">
            按钮
          </button>
        </div>
      </Probe>,
    )
    container
      .querySelector('[data-testid="btn"]')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  it('可交互元素（输入框）不触发', () => {
    const { container } = render(
      <Probe>
        <div data-window-drag>
          <input data-testid="input" />
        </div>
      </Probe>,
    )
    container
      .querySelector('[data-testid="input"]')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  it('监听器挂在 capture 阶段（内置脚本会先 stopPropagation）', () => {
    render(<Probe />)
    // 模拟 Tauri 内置脚本：在 capture 阶段拦截并停止传播
    const blocker = (e) => {
      e.stopPropagation()
    }
    document.addEventListener('pointerdown', blocker, true)

    const bar = document.createElement('div')
    bar.setAttribute('data-window-drag', '')
    const child = document.createElement('span')
    bar.appendChild(child)
    document.body.appendChild(bar)

    child.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))

    document.removeEventListener('pointerdown', blocker, true)
    document.body.removeChild(bar)

    // 我们的监听器同为 capture 且注册更早，仍应触发
    expect(invokeSpy).toHaveBeenCalledWith('plugin:window|start_dragging')
  })

  it('非 Tauri 环境不抛错', () => {
    delete window.__TAURI_INTERNALS__
    const { container } = render(
      <Probe>
        <div data-window-drag>
          <span data-testid="label">空白</span>
        </div>
      </Probe>,
    )
    expect(() =>
      container
        .querySelector('[data-testid="label"]')
        .dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
        ),
    ).not.toThrow()
  })
})
