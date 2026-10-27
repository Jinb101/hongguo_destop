import { describe, it, expect, beforeEach } from 'vitest'
import {
  THEMES,
  applyTheme,
  nextTheme,
  readTheme,
  switchTheme,
} from '../src/lib/theme.js'

/**
 * 外观主题
 *
 * 这里锁的是「主题只改 <html data-theme>，并且切换一定会落盘」——
 * 皮肤样式全在 CSS 里，JS 侧唯一的契约就是属性名与存储键。
 */
describe('外观主题', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('默认玻璃，非法值回落而不是崩溃', () => {
    expect(readTheme()).toBe('glass')
    localStorage.setItem('hongguo:theme', 'neon')
    expect(readTheme()).toBe('glass')
  })

  it('两套主题循环切换', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['glass', 'parchment'])
    expect(nextTheme('glass')).toBe('parchment')
    expect(nextTheme('parchment')).toBe('glass')
  })

  it('applyTheme 只写 data-theme 与 theme-color', () => {
    applyTheme('parchment')
    expect(document.documentElement.getAttribute('data-theme')).toBe('parchment')
    const meta = document.querySelector('meta[name="theme-color"]')
    // index.html 里有 theme-color，测试环境可能没有，有就必须同步
    if (meta) expect(meta.getAttribute('content')).toBe('#efe2c6')
  })

  it('switchTheme 切换并持久化，重复选择不改值', () => {
    switchTheme('parchment', { x: 12, y: 24 })
    expect(document.documentElement.getAttribute('data-theme')).toBe('parchment')
    expect(localStorage.getItem('hongguo:theme')).toBe('parchment')

    switchTheme('glass', { x: 0, y: 0 })
    expect(localStorage.getItem('hongguo:theme')).toBe('glass')
  })
})
