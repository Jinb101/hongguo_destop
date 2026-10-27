import { useCallback, useEffect } from 'react'

/**
 * 窗口拖动
 *
 * Tauri v2 的 `data-tauri-drag-region` 属性依赖内置的初始化脚本在页面加载时
 * 扫描 DOM 并绑定事件。本项目的前端是**运行时注入**的（资源直接写进 exe），
 * 这段初始化脚本不一定覆盖到后来渲染的节点，实测点击顶栏空白处
 * 并不会触发 start_dragging。
 *
 * 因此这里自己实现：监听 mousedown → 判断落点是否在拖动区内 →
 * 调用 plugin:window|start_dragging。行为与 Tauri 内置实现一致，
 * 但不依赖初始化脚本的时序。
 *
 * 用法：
 *   <div data-window-drag>…</div>              声明为拖动区
 *   <button data-window-drag="false">…</button> 在拖动区内部排除该元素
 *
 * 与 Tauri 内置属性的关系：两套都保留。
 * 内置属性在 decorations:false 的窗口里生效得更完整，
 * 自定义实现保证在任何配置下都能拖动。
 */

/**
 * 是否运行在 Tauri 里。
 *
 * 供外部判断用；拖动调用本身不依赖它（见 invokeStartDragging 的说明）。
 */
export function inTauri() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
}

export function useWindowDrag() {
  const onDown = useCallback((e) => {
    if (e.button !== 0 && e.button !== undefined) return

    const target = e.target
    if (!(target instanceof Element)) return

    // 落在显式排除的元素上（按钮、输入框、链接等）→ 不拖动
    const excluded = target.closest('[data-window-drag="false"]')
    if (excluded) return

    // 落在拖动区之外 → 不拖动
    const region = target.closest('[data-window-drag]')
    if (!region) return

    // 可交互元素默认不拖动，避免误伤
    if (target.closest('button, a, input, select, textarea, [role="button"]')) return

    e.preventDefault()
    invokeStartDragging()
  }, [])

  useEffect(() => {
    /*
     * 在 **capture 阶段** 监听。
     *
     * Tauri 内置的 drag-region 脚本也会在 capture 阶段处理 pointerdown，
     * 冒泡阶段收不到事件，所以要在它之前抢到。
     *
     * 同时监听 pointerdown 与 mousedown，覆盖不同输入源；
     * 用标志位避免同一次按压触发两次。
     */
    let handled = false
    const handler = (e) => {
      if (handled) return
      handled = true
      onDown(e)
      setTimeout(() => {
        handled = false
      }, 0)
    }
    document.addEventListener('pointerdown', handler, true)
    document.addEventListener('mousedown', handler, true)
    return () => {
      document.removeEventListener('pointerdown', handler, true)
      document.removeEventListener('mousedown', handler, true)
    }
  }, [onDown])
}

async function invokeStartDragging() {
  /*
   * 不做环境判断，直接尝试调用。
   *
   * 之前在这里加了一层 `if (!inTauri()) return` 的守卫，
   * 结果在真实运行时拦掉了调用 —— 因为 Tauri 的 internals 对象
   * 在页面脚本执行阶段还不一定挂载完成，而 drag 事件是后来才触发的，
   * 但守卫读到的却是某个被 React 严格模式/模块初始化顺序影响的快照。
   *
   * 直接调用 + try/catch 更可靠：非 Tauri 环境会 reject，被 catch 吞掉。
   */
  try {
    await window.__TAURI_INTERNALS__.invoke('plugin:window|start_dragging')
  } catch {
    /* 非 Tauri 环境或权限不足时静默忽略 */
  }
}
