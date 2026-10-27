import { isTauri } from './ipc.js'

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
