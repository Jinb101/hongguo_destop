import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

/**
 * Toast 提示
 *
 * 原版的 toast 用 setTimeout 散落在各处，且部分提示会叠加。
 * 这里统一管理：同 key 的提示会替换而非堆叠，最多同时 3 条。
 */
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const seq = useRef(0)

  const dismiss = useCallback((id) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (message, options = {}) => {
      const id = ++seq.current
      const key = options.key ?? message
      const duration = options.duration ?? 2600
      setItems((prev) => {
        const filtered = prev.filter((t) => t.key !== key)
        return [...filtered, { id, key, message, tone: options.tone ?? 'info' }].slice(-3)
      })
      if (duration > 0) setTimeout(() => dismiss(id), duration)
      return id
    },
    [dismiss],
  )

  const api = useMemo(() => ({ push, dismiss }), [push, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismiss(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}
