import { useCallback, useEffect, useState } from 'react'

/**
 * 外观主题
 *
 * 两套：玻璃（深色磨砂）与羊皮卷（暖纸衬线）。
 * 主题只改 <html data-theme>，具体颜色全部落在 CSS token 上，
 * 组件不需要知道自己跑在哪套皮肤里。
 *
 * 切换时以点击点为圆心做圆形扩散：
 *   - 优先用 View Transitions API（WebView2 / Chromium 111+ 原生支持）；
 *   - 不支持时退化成一层径向遮罩，观感一致但成本更低。
 */

const THEME_KEY = 'hongguo:theme'

export const THEMES = [
  { id: 'glass', label: '玻璃', hint: '深色磨砂，彩色光斑' },
  { id: 'parchment', label: '羊皮卷', hint: '暖纸底，朱砂点缀' },
]

const IDS = THEMES.map((t) => t.id)
const META_COLOR = { glass: '#0f1115', parchment: '#efe2c6' }

export function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (IDS.includes(saved)) return saved
  } catch {
    /* 存储不可用时用默认值 */
  }
  return 'glass'
}

export function nextTheme(current) {
  const i = IDS.indexOf(current)
  return IDS[(i + 1) % IDS.length]
}

/** 只负责把主题写到 DOM 上；持久化在 switchTheme 里做，避免预览时落盘。 */
export function applyTheme(id) {
  if (!IDS.includes(id)) return
  document.documentElement.setAttribute('data-theme', id)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', META_COLOR[id])
}

function persistTheme(id) {
  try {
    localStorage.setItem(THEME_KEY, id)
  } catch {
    /* 忽略写入失败 */
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * 切换主题并播放扩散过渡。
 * @param {string} id 目标主题
 * @param {{x?: number, y?: number}} origin 过渡圆心（一般取点击位置）
 */
export function switchTheme(id, origin = {}) {
  const apply = () => {
    persistTheme(id)
    applyTheme(id)
  }
  const x = origin.x ?? window.innerWidth / 2
  const y = origin.y ?? window.innerHeight / 2

  if (prefersReducedMotion() || typeof document.startViewTransition !== 'function') {
    apply()
    if (!prefersReducedMotion()) radialWipe(x, y, META_COLOR[id] ?? '#000')
    return
  }

  const transition = document.startViewTransition(apply)
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )
  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 560,
          easing: 'cubic-bezier(.22, 1, .36, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    .catch(() => {})
}

/** 无 View Transitions 时的降级：新主题底色从点击点铺开再淡出。 */
function radialWipe(x, y, color) {
  const layer = document.createElement('div')
  layer.className = 'theme-wipe'
  layer.style.background = color
  document.body.appendChild(layer)
  // 测试环境（jsdom）没有 Web Animations，直接跳过动画，主题已经切换完成
  if (typeof layer.animate !== 'function') {
    layer.remove()
    return
  }
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )
  const animation = layer.animate(
    [
      { clipPath: `circle(0px at ${x}px ${y}px)`, opacity: 1 },
      { clipPath: `circle(${radius}px at ${x}px ${y}px)`, opacity: 1, offset: 0.65 },
      { clipPath: `circle(${radius}px at ${x}px ${y}px)`, opacity: 0 },
    ],
    { duration: 620, easing: 'ease-out' },
  )
  animation?.finished?.finally(() => layer.remove()) ?? layer.remove()
}

/**
 * 主题状态。
 * 首帧的 data-theme 由 index.html 的内联脚本提前写入（避免闪白），
 * 这里只同步 React 状态与后续切换。
 */
export function useTheme() {
  const [theme, setTheme] = useState(readTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const choose = useCallback(
    (id, event) => {
      const target = IDS.includes(id) ? id : nextTheme(theme)
      if (target === theme) return target
      setTheme(target)
      switchTheme(target, {
        x: event?.clientX,
        y: event?.clientY,
      })
      return target
    },
    [theme],
  )

  const toggle = useCallback((event) => choose(nextTheme(theme), event), [choose, theme])

  return { theme, choose, toggle }
}
