import { useEffect, useState } from 'react'
import { call } from '../lib/ipc.js'
import { THEMES, useTheme } from '../lib/theme.js'
import { readAlwaysOnTop, setAlwaysOnTop } from '../lib/window-prefs.js'
import { useToast } from '../components/Toast.jsx'

/**
 * 设置
 *
 * 原版设置页把「账号、缓存预算、老板键、设备、更新、诊断」等 6 大类
 * 平铺在一张长页里，且带大量内部术语（老板键、原生验收回执、缓存预算）。
 *
 * 新结构：按「日常使用 / 播放与存储 / 高级」三组分区，
 * 内部术语翻译为用户能理解的语言；验收/诊断类收进「高级」并默认折叠。
 */
export default function SettingsView() {
  const toast = useToast()
  const { theme, choose } = useTheme()
  const [update, setUpdate] = useState(null)
  const [cache, setCache] = useState(null)
  const [busy, setBusy] = useState(false)
  const [onTop, setOnTop] = useState(readAlwaysOnTop)

  useEffect(() => {
    call('get_update_status', {})
      .then(setUpdate)
      .catch(() => {})
    call('get_boss_playback_state', {})
      .then(setCache)
      .catch(() => {})
  }, [])

  return (
    <div className="page">
      <header className="page-head">
        <h1>设置</h1>
        <p className="page-sub">播放、存储与账号</p>
      </header>

      <section className="panel">
        <h2>外观</h2>
        <Row label="皮肤" hint="点击立即切换，以点击点为圆心扩散">
          <div className="settings-themes">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`hdr-theme is-${t.id} ${theme === t.id ? 'is-active' : ''}`}
                onClick={(e) => choose(t.id, e)}
                aria-pressed={theme === t.id}
              >
                <span className="hdr-theme-swatch" aria-hidden="true" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row label="顶栏内容" hint="剧场切换 / 搜索 / 时钟可单独开关">
          <span className="muted">顶栏右上角的齿轮按钮</span>
        </Row>
      </section>

      <section className="panel">
        <h2>播放</h2>
        <Row label="默认清晰度" hint="网络较差时自动降档">
          <select defaultValue="auto" className="select">
            <option value="auto">自动</option>
            <option value="1080p">1080P</option>
            <option value="720p">720P</option>
            <option value="480p">480P</option>
          </select>
        </Row>
        <Row label="记住播放进度" hint="下次打开自动续播">
          <Toggle defaultChecked />
        </Row>
        <Row label="窗口置顶" hint="播放时始终显示在其他窗口上方">
          <Toggle
            checked={onTop}
            onChange={async (next) => {
              setOnTop(next)
              try {
                await setAlwaysOnTop(next)
                toast.push(next ? '窗口已置顶' : '已取消置顶')
              } catch (e) {
                setOnTop(!next)
                toast.push(`置顶设置失败：${e.message ?? e}`, { tone: 'error' })
              }
            }}
          />
        </Row>
      </section>

      <section className="panel">
        <h2>存储</h2>
        <Row label="离线缓存上限" hint="超出后自动清理最旧的文件">
          <select defaultValue="2" className="select">
            <option value="1">1 GB</option>
            <option value="2">2 GB</option>
            <option value="5">5 GB</option>
            <option value="10">10 GB</option>
          </select>
        </Row>
        <Row label="缓存占用" hint="当前已使用">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const res = await call('manage_playback_cache', { action: 'status' })
                setCache(res)
                toast.push('缓存占用已刷新')
              } catch (e) {
                toast.push(`刷新失败：${e.message ?? e}`, { tone: 'error' })
              } finally {
                setBusy(false)
              }
            }}
          >
            刷新
          </button>
        </Row>
        <Row label="立即清理缓存" hint="删除已下载的视频文件，不影响收藏">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await call('manage_playback_cache', { action: 'clear' })
                toast.push('缓存已清理')
              } catch (e) {
                toast.push(`清理失败：${e.message ?? e}`, { tone: 'error' })
              } finally {
                setBusy(false)
              }
            }}
          >
            清理
          </button>
        </Row>
      </section>

      <section className="panel">
        <h2>应用</h2>
        <Row label="版本" hint={update?.version ?? '1.0.19'}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const res = await call('check_app_update', {})
                if (res?.has_update) toast.push(`发现新版本 ${res.version ?? ''}`)
                else toast.push('已是最新版本')
              } catch (e) {
                toast.push(`检查失败：${e.message ?? e}`, { tone: 'error' })
              } finally {
                setBusy(false)
              }
            }}
          >
            检查更新
          </button>
        </Row>
      </section>

      <details className="panel panel-advanced">
        <summary>
          <h2>高级</h2>
          <span className="muted">诊断与验收工具</span>
        </summary>
        <Row label="运行诊断" hint="收集本机环境与播放链路信息">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              try {
                const res = await call('get_diagnostic_summary', {})
                toast.push(res?.summary ?? '诊断完成')
              } catch (e) {
                toast.push(`诊断失败：${e.message ?? e}`, { tone: 'error' })
              }
            }}
          >
            运行
          </button>
        </Row>
        <Row label="设备列表" hint="当前可用的签名设备">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              try {
                const res = await call('list_devices', {})
                toast.push(`共 ${(res ?? []).length} 台设备`)
              } catch (e) {
                toast.push(`读取失败：${e.message ?? e}`, { tone: 'error' })
              }
            }}
          >
            查看
          </button>
        </Row>
      </details>
    </div>
  )
}

function Row({ label, hint, children }) {
  return (
    <div className="prow">
      <div className="prow-text">
        <span className="prow-label">{label}</span>
        {hint && <span className="prow-hint">{hint}</span>}
      </div>
      <div className="prow-control">{children}</div>
    </div>
  )
}

function Toggle({ checked, defaultChecked = false, onChange }) {
  const [inner, setInner] = useState(defaultChecked)
  const on = checked ?? inner
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`toggle ${on ? 'is-on' : ''}`}
      onClick={() => {
        const next = !on
        if (checked === undefined) setInner(next)
        onChange?.(next)
      }}
    >
      <span className="toggle-knob" />
    </button>
  )
}
