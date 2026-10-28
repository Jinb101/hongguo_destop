import { useCallback, useEffect, useState } from 'react'
import { readState, writeState } from './ipc.js'

/**
 * 本机账号（持久登录）
 *
 * 红果云端账号走手机号 + 短信验证码（见 PhoneLoginPanel），
 * 与本机账号档案是两件事：下面这份是**本机档案**，
 * 即使没有登录也一直可用。
 *
 *   - 首次启动生成 guestId（一次性、跨启动不变），之后一直沿用；
 *   - 昵称、加入时间、最近活跃、启动次数都持久化；
 *   - 主副本写进 state.json（Rust 原子写），localStorage 只做首帧镜像，
 *     这样即使 WebView 数据被清，账号也不会丢。
 *
 * 换机/重装后 guestId 会重新生成，界面必须如实说明这一点，
 * 不能把本机档案包装成云端账号。
 */

const KEY = 'account'
const LOCAL_KEY = 'hongguo:account'
const NICKNAMES = ['本机观众', '沙发土豆', '追剧的人', '夜航船', '胶片收藏家', '深夜放映员']

const listeners = new Set()
let cache = null
let booting = null

function randomId() {
  try {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
  }
}

export function createProfile() {
  const now = Date.now()
  const guestId = randomId()
  return {
    guestId,
    nickname: NICKNAMES[parseInt(guestId.slice(0, 2), 16) % NICKNAMES.length],
    createdAt: now,
    lastActiveAt: now,
    visits: 1,
  }
}

/** 任何来源的档案都先过一遍类型断言，脏数据不能让整页崩。 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const guestId = typeof raw.guestId === 'string' && raw.guestId.length >= 8 ? raw.guestId : null
  if (!guestId) return null
  const nickname = typeof raw.nickname === 'string' ? raw.nickname.trim().slice(0, 16) : ''
  return {
    guestId,
    nickname: nickname || '本机观众',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    lastActiveAt: Number.isFinite(raw.lastActiveAt) ? raw.lastActiveAt : Date.now(),
    visits: Number.isFinite(raw.visits) && raw.visits > 0 ? Math.floor(raw.visits) : 1,
  }
}

function mirrorLocal(profile) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(profile))
  } catch {
    /* 忽略配额/隐私模式失败 */
  }
}

function emit(profile) {
  cache = profile
  for (const fn of listeners) fn(profile)
}

async function persist(profile) {
  mirrorLocal(profile)
  try {
    await writeState(KEY, profile)
  } catch {
    /* 落盘失败时内存与镜像仍然可用，不阻断界面 */
  }
}

/** 同步读首帧可用档案（可能为 null，调用方要有占位）。 */
export function peekAccount() {
  if (cache) return cache
  try {
    return normalize(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'))
  } catch {
    return null
  }
}

/**
 * 载入账号：state.json 为权威，localStorage 只做兜底镜像。
 * 每次进程启动只累加一次启动次数。
 */
export async function loadAccount() {
  if (cache) return cache
  if (booting) return booting
  booting = (async () => {
    let stored = null
    try {
      stored = normalize(await readState(KEY))
    } catch {
      /* 读不到就退回镜像 */
    }
    const profile = stored ?? peekAccount() ?? createProfile()
    const next = {
      ...profile,
      lastActiveAt: Date.now(),
      visits: stored ? profile.visits + 1 : profile.visits,
    }
    emit(next)
    await persist(next)
    return next
  })().finally(() => {
    booting = null
  })
  return booting
}

/** 只改昵称这类展示字段；其余字段由本模块维护。 */
export async function updateAccount(patch) {
  const base = cache ?? (await loadAccount())
  const next = normalize({ ...base, ...patch, lastActiveAt: Date.now() }) ?? base
  emit(next)
  await persist(next)
  return next
}

/** 退出本机账号：清空昵称与身份，下次启动视为新观众。 */
export async function resetAccount() {
  const next = createProfile()
  emit(next)
  await persist(next)
  return next
}

export function subscribeAccount(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 头像底色由 guestId 决定，同一身份永远是同一色。 */
export function avatarHue(profile) {
  const id = profile?.guestId ?? ''
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

export function useAccount() {
  const [profile, setProfile] = useState(() => peekAccount())

  useEffect(() => {
    let alive = true
    loadAccount()
      .then((p) => alive && setProfile(p))
      .catch(() => {})
    const off = subscribeAccount((p) => alive && setProfile(p))
    return () => {
      alive = false
      off()
    }
  }, [])

  const rename = useCallback((nickname) => updateAccount({ nickname }), [])
  const reset = useCallback(() => resetAccount(), [])

  return { profile, rename, reset }
}
