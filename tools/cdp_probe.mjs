// 用 WebView2 的 CDP 端口读自建壳的真实渲染错误。
// 用法：先带 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动 exe，再 node tools/cdp_probe.mjs
const BASE = process.env.CDP ?? 'http://127.0.0.1:9222'

const tabs = await (await fetch(`${BASE}/json`)).json()
const page = tabs.find((t) => t.type === 'page')
if (!page) {
  console.log('NO_PAGE_TARGET', JSON.stringify(tabs.map((t) => [t.type, t.url]), null, 1))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const events = []

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
  } else if (msg.method) {
    events.push(msg)
  }
}

await new Promise((r) => (ws.onopen = r))
await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Network.enable')

const probe = await send('Runtime.evaluate', {
  expression:
    process.argv[2] ??
    `JSON.stringify({
    url: location.href,
    title: document.title,
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    bodyLen: (document.body?.innerText ?? '').length,
    bodyHead: (document.body?.innerText ?? '').slice(0, 200),
    scripts: [...document.scripts].map(s => s.src || '(inline)'),
    styles: [...document.styleSheets].length,
  })`,
  returnByValue: true,
  awaitPromise: true,
})

console.log('PROBE', probe.result?.value ?? JSON.stringify(probe))

const failed = events.filter(
  (e) =>
    e.method === 'Log.entryAdded' ||
    (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type)) ||
    e.method === 'Runtime.exceptionThrown' ||
    (e.method === 'Network.loadingFailed' ?? false),
)
for (const e of failed.slice(0, 25)) {
  const p = e.params
  if (e.method === 'Log.entryAdded') console.log('LOG', p.entry.level, p.entry.text?.slice(0, 300), p.entry.url ?? '')
  else if (e.method === 'Runtime.consoleAPICalled')
    console.log('CONSOLE', p.type, (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300))
  else if (e.method === 'Runtime.exceptionThrown')
    console.log('EXCEPTION', p.exceptionDetails?.text, p.exceptionDetails?.exception?.description?.slice(0, 300))
  else console.log('NETFAIL', p.url, p.errorText)
}
ws.close()
process.exit(0)
