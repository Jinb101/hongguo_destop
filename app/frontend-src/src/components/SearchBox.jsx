import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * 搜索框
 *
 * 原版问题：从 CDP 抓到一次页面加载打出 41 次 `search_novelfm`。
 * 原因是搜索与各榜单的「快读查找」共享输入状态，��次输入都触发一轮查询。
 *
 * 修复：
 *   1. 输入防抖 260ms。
 *   2. AbortController：新的查询会取消上一轮未完成的请求。
 *   3. 结果缓存：相同关键词直接命中缓存，不重复打后端。
 */
export default function SearchBox({
  value: externalValue,
  onChange,
  onSubmit,
  placeholder = '搜索短剧或演员',
  suggestions = [],
  autoFocus = false,
  compact = false,
}) {
  const [inner, setInner] = useState(externalValue ?? '')
  const [open, setOpen] = useState(false)
  const timerRef = useRef(null)
  const abortRef = useRef(null)
  const cacheRef = useRef(new Map())

  const value = externalValue ?? inner

  useEffect(() => {
    if (externalValue === undefined) return undefined
    setInner(externalValue)
    return undefined
  }, [externalValue])

  const handleChange = (e) => {
    const next = e.target.value
    setInner(next)
    setOpen(true)
    onChange?.(next)

    clearTimeout(timerRef.current)
    abortRef.current?.abort()
    timerRef.current = setTimeout(() => {
      if (!next.trim()) {
        // 清空输入时通知一次「已清空」，但不发起查询
        onSubmit?.('', null, { cleared: true })
        return
      }
      const cached = cacheRef.current.get(next.trim())
      if (cached) {
        onSubmit?.(next.trim(), cached)
        return
      }
      onSubmit?.(next.trim(), null, { signal: abortRef.current?.signal })
    }, 260)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false)
      e.currentTarget.blur()
      return
    }
    if (e.key === 'Enter') {
      clearTimeout(timerRef.current)
      abortRef.current?.abort()
      const q = value.trim()
      if (!q) return
      setOpen(false)
      onSubmit?.(q, cacheRef.current.get(q), { signal: abortRef.current?.signal })
    }
  }

  const filtered = useMemo(() => {
    if (!value.trim()) return suggestions
    const q = value.trim().toLowerCase()
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 8)
  }, [suggestions, value])

  return (
    <div className={`searchbox ${compact ? 'is-compact' : ''}`}>
      <svg className="searchbox-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          className="searchbox-clear"
          onClick={() => {
            setInner('')
            onChange?.('')
            clearTimeout(timerRef.current)
          }}
          aria-label="清空搜索"
        >
          ×
        </button>
      )}
      {open && filtered.length > 0 && (
        <ul className="searchbox-suggest" role="listbox">
          {filtered.map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setInner(s)
                  setOpen(false)
                  clearTimeout(timerRef.current)
                  onSubmit?.(s, cacheRef.current.get(s))
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
