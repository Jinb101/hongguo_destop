// 用本机 Chrome 把 SVG 光栅化成 PNG / 24 位 BMP。
// 用途：NSIS 安装器的头图与侧图只吃 BMP，Tauri 的 tauri icon 又不能指定画布尺寸。
// 用法：node tools/render_svg.mjs <input.svg> <output.png|bmp> <宽> <高>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CHROME_PORT ?? 9333)

const [svgPath, outPath, wArg, hArg] = process.argv.slice(2)
if (!svgPath || !outPath) {
  console.error('usage: node tools/render_svg.mjs <input.svg> <output.png|bmp> <width> <height>')
  process.exit(1)
}
const width = Number(wArg ?? 0)
const height = Number(hArg ?? 0)
if (!width || !height) {
  console.error('width/height required')
  process.exit(1)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-chrome-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function waitFor(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`chrome 未就绪: ${url}`)
}

try {
  await waitFor(`http://127.0.0.1:${PORT}/json/version`)
  const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  const page = tabs.find((t) => t.type === 'page')
  if (!page) throw new Error('没有可用页面')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let id = 0
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    const slot = msg.id ? pending.get(msg.id) : null
    if (!slot) return
    pending.delete(msg.id)
    if (msg.error) slot.reject(new Error(msg.error.message))
    else slot.resolve(msg.result ?? {})
  }
  await new Promise((r) => (ws.onopen = r))

  const svg = fs.readFileSync(svgPath, 'utf8')
  const expression = `(async () => {
    const svg = ${JSON.stringify(svg)};
    const w = ${width}, h = ${height};
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const fmt = ${JSON.stringify(path.extname(outPath).toLowerCase())};
    if (fmt !== '.png') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    if (fmt === '.png') {
      return { png: canvas.toDataURL('image/png').split(',')[1] };
    }
    const data = ctx.getImageData(0, 0, w, h).data;
    let bin = '';
    const step = 0x8000;
    for (let i = 0; i < data.length; i += step) {
      bin += String.fromCharCode.apply(null, data.subarray(i, i + step));
    }
    return { rgba: btoa(bin) };
  })()`

  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
  const value = res.result?.value ?? {}
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })

  if (value.png) {
    fs.writeFileSync(outPath, Buffer.from(value.png, 'base64'))
  } else if (value.rgba) {
    const rgba = Buffer.from(value.rgba, 'base64')
    fs.writeFileSync(outPath, encodeBmp(rgba, width, height))
  } else {
    throw new Error('canvas 没有返回图像数据')
  }
  console.log(`saved ${outPath} (${width}x${height})`)
} finally {
  chrome.kill()
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500).unref()
}

/** 24 位未压缩 BMP：行序自下而上，行宽按 4 字节对齐。 */
function encodeBmp(rgba, w, h) {
  const rowSize = Math.ceil((w * 3) / 4) * 4
  const pixels = Buffer.alloc(rowSize * h)
  for (let y = 0; y < h; y += 1) {
    const srcY = h - 1 - y
    for (let x = 0; x < w; x += 1) {
      const s = (srcY * w + x) * 4
      const d = y * rowSize + x * 3
      pixels[d] = rgba[s + 2]
      pixels[d + 1] = rgba[s + 1]
      pixels[d + 2] = rgba[s]
    }
  }
  const header = Buffer.alloc(54)
  header.write('BM', 0)
  header.writeUInt32LE(54 + pixels.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(w, 18)
  header.writeInt32LE(h, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(pixels.length, 34)
  header.writeInt32LE(2835, 38)
  header.writeInt32LE(2835, 42)
  return Buffer.concat([header, pixels])
}
