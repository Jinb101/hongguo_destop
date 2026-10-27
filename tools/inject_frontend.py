"""
把重构后的前端资源注入 Tauri exe
==================================

原理见 tauri_assets.py：Tauri v2 把前端产物以
`phf::Map<&str, (&[u8], AssetKey)>` 形式编译进 .rdata，
每个 entry 是 4 个 u64 (key_ptr, key_len, value_ptr, value_len)，
value 指向 **brotli 压缩** 的内容。

替换步骤：
  1. 用 brotli 压缩新资源（quality 11，最大压缩率）
  2. 若压缩后长度 <= 原长度：原地覆盖 + 补零填充（最简单，段布局不变）
  3. 若压缩后长度 > 原长度：把新数据追加到文件末尾，
     更新 entry 里的 value_ptr（指向新的 RVA）与 value_len。
     追加在文件末尾不影响任何已有 RVA，因此无需重排段表。

第 3 步的注意事项：
  - 追加的字节必须落在某个段的 raw 范围内才能被 RVA 映射到。
    做法：把 .rdata 段的 raw size 扩大，同时把文件尾补零，
    使新数据位于 .rdata 段 raddr + rsize 之后的紧邻位置，
    并把该段的 vsize/rsize 相应增大。这样 RVA 连续，无需搬移任何数据。
"""

import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pydeps'))
import brotli  # noqa: E402

from tauri_assets import PE, find_asset_entries  # noqa: E402

QUALITY = 11


def compress(data: bytes) -> bytes:
    return brotli.compress(data, quality=QUALITY)


def patch_assets(exe_path, replacements, out_path=None, backup=True):
    """
    replacements: {asset_key: new_bytes}
      asset_key 形如 '/index.html'、'/assets/index-XXX.css'
    """
    exe_path = os.path.abspath(exe_path)
    out_path = out_path or exe_path

    pe = PE(exe_path)
    entries = find_asset_entries(pe)
    data = pe.data

    if backup and os.path.abspath(out_path) == exe_path:
        bak = exe_path + '.orig'
        if not os.path.exists(bak):
            with open(exe_path, 'rb') as f:
                with open(bak, 'wb') as g:
                    g.write(f.read())
            print(f'已备份原文件 -> {bak}')

    # .rdata 段用于追加新数据
    rd = next(s for s in pe.sections if s['name'] == '.rdata')
    rdata_end = rd['raddr'] + rd['rsize']

    report = []

    for key, new_bytes in replacements.items():
        key_b = key.encode() if isinstance(key, str) else key
        if key_b not in entries:
            print(f'  ! 资源不存在: {key_b!r}，跳过')
            report.append((key_b.decode(), 'missing', 0, 0))
            continue

        e = entries[key_b]
        comp = compress(new_bytes)
        old_len = e['value_len']
        old_off = e['value_off']

        if len(comp) <= old_len:
            # 原地覆盖，剩余部分填 0
            data[old_off:old_off + len(comp)] = comp
            for i in range(old_off + len(comp), old_off + old_len):
                data[i] = 0
            struct.pack_into('<Q', data, e['entry_off'] + 24, old_len)  # value_len 不变
            report.append((key_b.decode(), 'in-place', len(comp), old_len))
            print(f'  ✓ {key_b.decode():42s} 原地覆盖  {old_len} -> {len(comp)}')
        else:
            # 追加到 .rdata 段末尾之后，并把段扩大
            new_off = rdata_end
            # 需要把文件填充到 new_off
            if len(data) < new_off:
                data.extend(b'\x00' * (new_off - len(data)))
            data.extend(comp)

            # 新偏移对应的 RVA = rdata.vaddr + (new_off - rdata.raddr)
            new_rva = rd['vaddr'] + (new_off - rd['raddr'])
            new_va = pe.image_base + new_rva

            struct.pack_into('<Q', data, e['entry_off'] + 16, new_va)  # value_ptr
            struct.pack_into('<Q', data, e['entry_off'] + 24, len(comp))  # value_len

            # 扩大 .rdata 段的 raw size / virtual size
            grow = (new_off + len(comp)) - rdata_end
            struct.pack_into('<I', data, rd['hdr'] + 8, rd['vsize'] + grow)   # VirtualSize
            struct.pack_into('<I', data, rd['hdr'] + 16, rd['rsize'] + grow)  # SizeOfRawData
            rdata_end = new_off + len(comp)
            # 后续资源若还要追加，需同步更新 rdata_end（已在上方完成）
            rd['rsize'] += grow
            rd['vsize'] += grow

            report.append((key_b.decode(), 'appended', len(comp), old_len))
            print(f'  ✓ {key_b.decode():42s} 追加写入  {old_len} -> {len(comp)}  (+{grow} 字节)')

    with open(out_path, 'wb') as f:
        f.write(bytes(data))
    return report


def main():
    exe = sys.argv[1] if len(sys.argv) > 1 else r'D:\红果免费短剧\hongguo-desktop-companion.exe'
    dist = sys.argv[2] if len(sys.argv) > 2 else r'D:\IDEA\hongguo-destop\app\frontend-src\dist'
    out = sys.argv[3] if len(sys.argv) > 3 else exe

    # Tauri 资源 key 是编译期固定的，内容变了 hash 也会变，
    # 但 key 字符串本身不变（/assets/index-XXX.css）。
    # 因此按「key 的扩展名 + 前缀」去 dist 里匹配实际文件。
    def pick(ext):
        """在 dist/assets 里按扩展名找入口文件，优先 index<ext>。"""
        d = os.path.join(dist, 'assets')
        if not os.path.isdir(d):
            return None
        want = 'index' + ext
        if want in os.listdir(d):
            return os.path.join(d, want)
        cands = sorted(f for f in os.listdir(d) if f.endswith(ext))
        return os.path.join(d, cands[0]) if cands else None

    css_path = pick('.css')
    js_path = pick('.js')

    with open(os.path.join(dist, 'index.html'), 'rb') as f:
        html = f.read()

    replacements = {}

    if css_path:
        with open(css_path, 'rb') as f:
            css = f.read()
        # 关键：资源表里的 key 是编译期固定的
        #   /assets/index-BrrRYD-G.css
        #   /assets/index-CTpIsaLU.js
        # 而 dist 里文件名随内容 hash 变化（index-XXXX.css）。
        # HTML 里引用的路径必须改成资源表里真实存在的 key，
        # 否则 Tauri 的资源处理器会 404，页面一片空白。
        html = html.replace(
            b'/assets/' + os.path.basename(css_path).encode(),
            b'/assets/index-BrrRYD-G.css',
        )
        replacements['/assets/index-BrrRYD-G.css'] = css

    if js_path:
        with open(js_path, 'rb') as f:
            js = f.read()
        html = html.replace(
            b'/assets/' + os.path.basename(js_path).encode(),
            b'/assets/index-CTpIsaLU.js',
        )
        replacements['/assets/index-CTpIsaLU.js'] = js

    replacements['/index.html'] = html

    for key, blob in replacements.items():
        print(f'  读取 {key:42s} {len(blob):>8} 字节')

    print()
    patch_assets(exe, replacements, out)


if __name__ == '__main__':
    main()
