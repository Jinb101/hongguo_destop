import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * 本机账号
 *
 * 「账号持久登录」在当前没有签名服务的阶段就是本机档案：
 * 身份只生成一次、昵称可改、重启后仍是同一个 guestId。
 * 这里锁住的就是这三条，以及脏数据不能把界面带崩。
 */
const KEY = 'hongguo:account'

function readMirror() {
  return JSON.parse(localStorage.getItem(KEY) || 'null')
}

describe('本机账号', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('首次载入生成身份并写两份存储', async () => {
    const mod = await import('../src/lib/account.js')
    const profile = await mod.loadAccount()

    expect(profile.guestId).toMatch(/^[0-9a-f]{16}$/)
    expect(profile.nickname.length).toBeGreaterThan(0)
    expect(readMirror().guestId).toBe(profile.guestId)
  })

  it('重启后沿用同一身份，启动次数累加', async () => {
    const first = await (await import('../src/lib/account.js')).loadAccount()

    // 模拟重启：模块缓存清空，只剩落盘数据
    vi.resetModules()
    const second = await (await import('../src/lib/account.js')).loadAccount()

    expect(second.guestId).toBe(first.guestId)
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.visits).toBe(first.visits + 1)
  })

  it('改名持久化，并且能被下一次启动读回', async () => {
    const mod = await import('../src/lib/account.js')
    const first = await mod.loadAccount()
    await mod.updateAccount({ nickname: '  夜航船  ' })

    vi.resetModules()
    const again = await (await import('../src/lib/account.js')).loadAccount()
    expect(again.nickname).toBe('夜航船')
    expect(again.guestId).toBe(first.guestId)
  })

  it('退出本机账号会换掉身份', async () => {
    const mod = await import('../src/lib/account.js')
    const first = await mod.loadAccount()
    const reset = await mod.resetAccount()

    expect(reset.guestId).not.toBe(first.guestId)
    expect(readMirror().guestId).toBe(reset.guestId)
  })

  it('存储里的脏数据被丢弃而不是传进渲染', async () => {
    localStorage.setItem(KEY, JSON.stringify({ guestId: 42, nickname: { x: 1 } }))
    const mod = await import('../src/lib/account.js')
    const profile = await mod.loadAccount()

    expect(typeof profile.guestId).toBe('string')
    expect(typeof profile.nickname).toBe('string')
    expect(profile.guestId).not.toBe('42')
  })

  it('头像色由身份决定，同一身份恒定', async () => {
    const mod = await import('../src/lib/account.js')
    const a = mod.createProfile()
    const b = { ...a, nickname: '另一个名字' }
    expect(mod.avatarHue(a)).toBe(mod.avatarHue(b))
    expect(mod.avatarHue(a)).toBeGreaterThanOrEqual(0)
    expect(mod.avatarHue(a)).toBeLessThan(360)
  })
})
