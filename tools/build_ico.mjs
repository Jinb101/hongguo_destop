// 把若干 PNG 打包成多尺寸 .ico（每帧用 PNG 压缩，Vista+ 支持）。
// 用法：node tools/build_ico.mjs <out.ico> <16.png> <24.png> ...
import fs from 'node:fs'

const [out, ...inputs] = process.argv.slice(2)
if (!out || inputs.length === 0) {
  console.error('usage: node tools/build_ico.mjs <out.ico> <a.png> <b.png> ...')
  process.exit(1)
}

const frames = inputs
  .map((file) => {
    const png = fs.readFileSync(file)
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    return { png, width, height }
  })
  .sort((a, b) => a.width - b.width)

const dir = Buffer.alloc(6)
dir.writeUInt16LE(0, 0)
dir.writeUInt16LE(1, 2)
dir.writeUInt16LE(frames.length, 4)

let offset = 6 + frames.length * 16
const entries = frames.map((frame) => {
  const entry = Buffer.alloc(16)
  entry[0] = frame.width >= 256 ? 0 : frame.width
  entry[1] = frame.height >= 256 ? 0 : frame.height
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bpp
  entry.writeUInt32LE(frame.png.length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += frame.png.length
  return entry
})

fs.writeFileSync(out, Buffer.concat([dir, ...entries, ...frames.map((f) => f.png)]))
console.log(`saved ${out} (${frames.map((f) => f.width).join(', ')})`)
