import { isTauri } from './ipc.js'

/**
 * 宿主平台判定。
 *
 * macOS 下窗口用原生装饰（titleBarStyle: Overlay），交通灯和拖动都由系统提供，
 * 前端不要再画一套按钮；Windows 侧仍是无边框窗口，按钮必须自己渲染。
 */
export function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  return /Macintosh|Mac OS X/.test(navigator.userAgent) || navigator.platform === 'MacIntel'
}

/**
 * 窗口级偏好（目前只有「置顶」）。
 *
 * 放在 localStorage 里是因为它必须在第一帧就可用；
 * 真正生效要调用 Tauri 的 setAlwaysOnTop，浏览器模式下只记住开关。
 */

const KEY = 'hongguo:always-on-top'

export function readAlwaysOnTop() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

async function applyToWindow(on) {
  if (!isTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setAlwaysOnTop(on)
}

export async function setAlwaysOnTop(on) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* 忽略写入失败 */
  }
  await applyToWindow(on)
  return on
}

/** 启动时恢复上次的置顶状态。 */
export async function restoreAlwaysOnTop() {
  if (!readAlwaysOnTop()) return false
  try {
    await applyToWindow(true)
    return true
  } catch {
    return false
  }
}
