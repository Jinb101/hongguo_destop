import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

/**
 * 手机验证那一步的错误必须可见。
 *
 * 之前「我已发送，继续验证」失败时错误只写进 state、那一屏却没渲染，
 * 用户点完什么提示都没有，看起来像按钮没反应。
 */

const call = vi.fn()
const callOnce = vi.fn()

vi.mock('../src/lib/ipc.js', () => ({
  call: (...args) => call(...args),
  callOnce: (...args) => callOnce(...args),
}))

const { ToastProvider } = await import('../src/components/Toast.jsx')
const { default: PhoneLoginPanel } = await import('../src/components/PhoneLoginPanel.jsx')

const verifyStatus = {
  authenticated: false,
  loginAvailable: true,
  phase: 'verification_required',
  displayName: '',
  retryAfter: 0,
  verification: { kind: 'upsms', destination: '1069xxxx', content: '红果验证', expiresIn: 240 },
}

function renderPanel() {
  return render(
    <ToastProvider>
      <PhoneLoginPanel />
    </ToastProvider>,
  )
}

describe('PhoneLoginPanel 手机验证', () => {
  beforeEach(() => {
    call.mockReset()
    callOnce.mockReset()
  })

  it('进入验证页后展示发送指引', async () => {
    call.mockResolvedValue(verifyStatus)
    callOnce.mockResolvedValue(verifyStatus)
    renderPanel()

    await waitFor(() => expect(screen.getByText('完成手机验证')).toBeTruthy())
    expect(screen.getByText('1069xxxx')).toBeTruthy()
    expect(screen.getByText(/约 4 分钟内完成/)).toBeTruthy()
  })

  it('继续验证失败时把原因显示出来，而不是静默', async () => {
    const loginStatus = { authenticated: false, loginAvailable: true, retryAfter: 0 }
    call.mockResolvedValue(loginStatus)
    callOnce
      .mockResolvedValueOnce(verifyStatus) // login 返回"需要验证"
      .mockRejectedValueOnce(new Error('红果尚未确认手机验证，请完成后再点继续'))

    const { container } = renderPanel()
    await waitFor(() => expect(container.querySelector('#phone-number')).toBeTruthy())

    fireEvent.change(container.querySelector('#phone-number'), { target: { value: '13800138000' } })
    fireEvent.change(container.querySelector('#phone-code'), { target: { value: '123456' } })
    fireEvent.click(container.querySelector('.phone-submit'))
    await waitFor(() => expect(screen.getByText('完成手机验证')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '我已发送，继续验证' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('尚未确认手机验证'),
    )
    expect(screen.getByRole('button', { name: '我已发送，继续验证' })).toBeTruthy()
  })
})
