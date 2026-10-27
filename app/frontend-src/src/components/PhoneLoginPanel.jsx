import { useCallback, useEffect, useRef, useState } from 'react'
import { call, callOnce } from '../lib/ipc.js'
import { useToast } from './Toast.jsx'

/**
 * 手机号登录
 *
 * 原版逻辑逆向自 hongguo-desktop-companion.exe 的前端产物，
 * 完整状态机是四段式：
 *
 *   ① 服务不可用  → phone_account_status 返回 unavailable
 *   ② 待登录      → 手机号 + 短信验证码
 *        ├─ phone_account_send_code { phone } → 下发验证码，开始 60s 倒计时
 *        └─ phone_account_login { phone, code }
 *              ├─ authenticated        → 登录成功
 *              └─ verification        → 需要人工短信验证（见 ③）
 *   ③ 短信验证    → verification { destination, content, expiresIn }
 *        ├─ phone_account_continue → 确认已发送，继续验证
 *        └─ phone_account_logout   → 取消验证
 *   ④ 已登录      → 显示账号名 + 退出按钮
 *
 * 原版的关键约束（照搬）：
 *   - 手机号只取数字，maxLength 11
 *   - 验证码 4–8 位数字，pattern /^\d{4,8}$/
 *   - 发送后 60 秒内不能重发（retryAfter 由服务端给）
 *   - 验证码直接提交红果账号服务，不写入本地存储
 *   - 会话只保存在内存，退出应用即失效
 */
export default function PhoneLoginPanel() {
  const toast = useToast()
  const [status, setStatus] = useState(null) // phone_account_status 响应
  const [phase, setPhase] = useState('checking') // checking | unavailable | login | verify | authed
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(null) // 正在执行的动作名
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    checkStatus()
    return () => {
      aliveRef.current = false
    }
  }, [])

  /** 读取账号服务状态。 */
  const checkStatus = useCallback(async () => {
    try {
      const res = await call('phone_account_status', {})
      if (!aliveRef.current) return
      setStatus(res ?? {})
      // 实测返回：{ authenticated, loginAvailable, unavailableReason,
      //             displayName, retryAfter, lastSync, phase, verification }
      if (res?.authenticated) setPhase('authed')
      else if (res?.loginAvailable === false) setPhase('unavailable')
      else setPhase('login')
    } catch (e) {
      if (!aliveRef.current) return
      // 直接把路由表给的原因透出来（缺签名 / 需要验证），不要含糊成"稍后重试"
      setStatus({ unavailableReason: e.message ?? '账号服务暂不可用，请稍后重新打开此页' })
      setPhase('unavailable')
    }
  }, [])

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return undefined
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  /** 发送短信验证码。 */
  const sendCode = useCallback(async () => {
    if (!/^1\d{10}$/.test(phone)) {
      setError('请输入 11 位手机号')
      return
    }
    setBusy('send')
    setError('')
    try {
      const res = await callOnce('phone_account_send_code', { phone })
      if (!aliveRef.current) return
      setStatus(res ?? {})
      const wait = Number(res?.retryAfter ?? 60)
      setCountdown(wait)
      setCode('')
      toast.push('红果已受理验证码请求，请查看手机短信')
    } catch (e) {
      if (aliveRef.current) setError(e.message ?? String(e))
    } finally {
      if (aliveRef.current) setBusy(null)
    }
  }, [phone, toast])

  /** 提交手机号 + 验证码登录。 */
  const login = useCallback(async () => {
    if (!/^\d{4,8}$/.test(code)) {
      setError('请输入 4–8 位短信验证码')
      return
    }
    setBusy('login')
    setError('')
    try {
      const res = await callOnce('phone_account_login', { phone, code })
      if (!aliveRef.current) return
      setStatus(res ?? {})
      if (res?.authenticated) {
        setPhase('authed')
        setCode('')
        toast.push('登录成功，可以读取云片单')
      } else if (res?.verification) {
        setPhase('verify')
        toast.push('还需完成手机验证，账号尚未登录')
      } else {
        setError('登录未完成，请重试')
      }
    } catch (e) {
      if (aliveRef.current) setError(e.message ?? String(e))
    } finally {
      if (aliveRef.current) setBusy(null)
    }
  }, [phone, code, toast])

  /** 确认已发送验证短信，继续验证。 */
  const continueVerify = useCallback(async () => {
    setBusy('continue')
    setError('')
    try {
      const res = await callOnce('phone_account_continue', {})
      if (!aliveRef.current) return
      setStatus(res ?? {})
      if (res?.authenticated) {
        setPhase('authed')
        toast.push('登录成功，可以读取云片单')
      } else {
        toast.push('红果仍要求手机验证，请核对后继续')
      }
    } catch (e) {
      if (aliveRef.current) setError(e.message ?? String(e))
    } finally {
      if (aliveRef.current) setBusy(null)
    }
  }, [toast])

  /** 取消验证 / 退出账号。 */
  const logout = useCallback(async () => {
    setBusy('logout')
    setError('')
    try {
      const res = await callOnce('phone_account_logout', {})
      if (!aliveRef.current) return
      setStatus(res ?? {})
      setPhase(res?.authenticated ? 'authed' : 'login')
      setPhone('')
      setCode('')
      toast.push(res?.authenticated ? '已退出，当前账号会话已清除' : '已取消验证，验证码和待验证资料已清除')
    } catch (e) {
      if (aliveRef.current) setError(e.message ?? String(e))
    } finally {
      if (aliveRef.current) setBusy(null)
    }
  }, [toast])

  /* ---------------- 渲染 ---------------- */

  if (phase === 'checking') {
    return <p className="muted">正在检查账号服务…</p>
  }

  if (phase === 'unavailable') {
    return (
      <div className="phone-login">
        <p className="phone-note" role="status">
          {status?.unavailableReason || '此候选版暂不支持登录，验证码请求已暂停。'}
        </p>
        <button type="button" className="btn btn-ghost" onClick={checkStatus}>
          重新检测
        </button>
      </div>
    )
  }

  if (phase === 'authed') {
    return (
      <div className="phone-login">
        <div className="phone-identity">
          <span className="phone-avatar" aria-hidden="true">
            {(status?.displayName || '红').slice(0, 1)}
          </span>
          <div>
            <strong>{status?.displayName || '已登录红果账号'}</strong>
            <span className="phone-note">已连接手机红果 · 只读片单</span>
          </div>
        </div>
        <p className="phone-note">
          此候选版会话仅保存在内存，退出应用后需要重新登录。
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy === 'logout'}
          onClick={logout}
        >
          {busy === 'logout' ? '退出中…' : '退出账号'}
        </button>
      </div>
    )
  }

  if (phase === 'verify') {
    const v = status?.verification ?? {}
    const expired = v.expiresIn ? Date.now() > v.expiresAt : false
    return (
      <div className="phone-login">
        <h3 className="phone-verify-title">完成手机验证</h3>
        <p className="phone-note">
          红果要求使用正在登录的手机号发送一条短信。请在手机短信应用中核对以下内容并发送，
          然后回来继续。
        </p>
        <dl className="phone-verify">
          <dt>发送到</dt>
          <dd>{v.destination ?? '—'}</dd>
          <dt>短信内容</dt>
          <dd>{v.content ?? '—'}</dd>
        </dl>
        <p className="phone-note">
          {expired ? '此次验证已过期，请取消后重新登录。' : '请尽快在有效期内完成，短信费用按运营商标准收取。'}
        </p>
        <div className="phone-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy === 'continue' || expired}
            onClick={continueVerify}
          >
            {busy === 'continue' ? '确认中…' : '我已发送，继续验证'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy === 'logout'}
            onClick={logout}
          >
            取消验证
          </button>
        </div>
      </div>
    )
  }

  // phase === 'login'
  const phoneValid = /^1\d{10}$/.test(phone)
  const codeValid = /^\d{4,8}$/.test(code)

  return (
    <form
      className="phone-login"
      onSubmit={(e) => {
        e.preventDefault()
        if (phoneValid && codeValid) login()
      }}
    >
      <label className="phone-label" htmlFor="phone-number">
        手机号
      </label>
      <div className="phone-row">
        <span className="phone-prefix">+86</span>
        <input
          id="phone-number"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          maxLength={11}
          value={phone}
          disabled={busy !== null}
          placeholder="手机红果绑定的手机号"
          onChange={(e) => {
            setPhone(e.target.value.replace(/\D/g, ''))
            setCode('')
            setError('')
          }}
        />
      </div>

      <label className="phone-label" htmlFor="phone-code">
        短信验证码
      </label>
      <div className="phone-row">
        <input
          id="phone-code"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={code}
          disabled={busy !== null}
          placeholder="收到后输入"
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ''))
            setError('')
          }}
        />
        <button
          type="button"
          className="btn btn-ghost phone-send"
          disabled={!phoneValid || busy !== null || countdown > 0}
          onClick={sendCode}
        >
          {busy === 'send' ? '发送中…' : countdown > 0 ? `${countdown} 秒后重试` : '获取验证码'}
        </button>
      </div>

      <button
        type="submit"
        className="btn btn-primary phone-submit"
        disabled={!phoneValid || !codeValid || busy !== null}
      >
        {busy === 'login' ? '正在验证…' : '登录'}
      </button>

      <p className="phone-note">验证码直接提交至红果账号服务，不写入本地记录。</p>
      {error ? (
        <p className="phone-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}
