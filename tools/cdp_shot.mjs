// 通过 WebView2 的 CDP 端口截图。
// 用法：带 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动 exe，
//       node tools/cdp_shot.mjs <输出路径>
// 比 shot_window.ps1 可靠：不依赖窗口前置，也不受桌面缩放/遮挡影响。
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.CDP ?? 'http://127.0.0.1:9222'
const out = process.argv[2] ?? 'shots-new/cdp-shot.png'

const tabs = await (await fetch(`${BASE}/json`)).json()
const page = tabs.find((t) => t.type === 'page')
if (!page) {
  console.log('NO_PAGE_TARGET', JSON.stringify(tabs.map((t) => [t.type, t.url])))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? {})
    pending.delete(msg.id)
  }
}

await new Promise((r) => (ws.onopen = r))
await send('Page.enable')

const { data } = await send('Page.captureScreenshot', { format: 'png' })
if (!data) {
  console.log('EMPTY_SCREENSHOT')
  process.exit(1)
}

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, Buffer.from(data, 'base64'))
console.log(`saved=${path.resolve(out)}`)
