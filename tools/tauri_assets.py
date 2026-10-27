"""
Tauri v2 内嵌资源表解析 / 替换工具
=====================================

逆向结论（来自 hongguo-desktop-companion.exe v1.0.19）：

1. Tauri v2 把前端产物通过 `tauri-codegen` 编译进 exe 的 .rdata 段，
   存储形式是 `phf::Map<&'static str, (&'static [u8], AssetKey)>`。

2. phf 的每个 entry 在 .rdata 里是 4 个连续 u64：
       (key_ptr, key_len, value_ptr, value_len)
   其中 key_ptr 指向资源路径字符串（如 b"/assets/index-BrrRYD-G.css"），
   value_ptr 指向 **brotli 压缩后** 的内容，value_len 是压缩后长度。

3. 资源 key 的形式：
       /index.html                      → 实际路径 "cn.guoban.desktop-companion/main/index.html"
       /assets/index-XXXX.css
       /assets/index-XXXX.js
   注意 Tauri 会把 key 与其 AssetKey 字符串池放在一起，肉眼搜路径串能找到 key，
   但 key_ptr 本身要靠 PE 段表换算 RVA 得到。

4. 替换资源 = 用 brotli 压缩新内容 → 写回 value_ptr 处 → 更新 value_len。
   若新压缩数据长度与原长度不同，需要同时调整 .rdata 段布局，
   最省事的做法是「原地填充 + 尾部追加」，并把 value_len 指向新位置。
"""

import struct
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pydeps'))
import brotli  # noqa: E402


class PE:
    def __init__(self, path):
        self.path = path
        with open(path, 'rb') as f:
            self.data = bytearray(f.read())
        self._parse_pe()

    def _parse_pe(self):
        d = self.data
        pe_off = struct.unpack_from('<I', d, 0x3C)[0]
        assert d[pe_off:pe_off + 4] == b'PE\x00\x00', 'not a PE file'
        nsec = struct.unpack_from('<H', d, pe_off + 6)[0]
        opt_size = struct.unpack_from('<H', d, pe_off + 20)[0]
        opt_off = pe_off + 24
        self.image_base = struct.unpack_from('<Q', d, opt_off + 24)[0]
        sec_off = opt_off + opt_size
        self.sections = []
        for i in range(nsec):
            o = sec_off + i * 40
            name = d[o:o + 8].rstrip(b'\x00').decode('ascii', 'replace')
            vsize, vaddr, rsize, raddr = struct.unpack_from('<IIII', d, o + 8)
            self.sections.append(
                {'name': name, 'vaddr': vaddr, 'vsize': vsize,
                 'raddr': raddr, 'rsize': rsize, 'hdr': o}
            )

    def rva2off(self, rva):
        for s in self.sections:
            if s['vaddr'] <= rva < s['vaddr'] + max(s['vsize'], s['rsize']):
                return s['raddr'] + (rva - s['vaddr'])
        raise ValueError(f'rva {rva:#x} 不在任何段内')

    def off2rva(self, off):
        for s in self.sections:
            if s['raddr'] <= off < s['raddr'] + s['rsize']:
                return s['vaddr'] + (off - s['raddr'])
        raise ValueError(f'offset {off:#x} 不在任何段内')

    def va2off(self, va):
        return self.rva2off(va - self.image_base)

    def read_va(self, va, length):
        off = self.va2off(va)
        return bytes(self.data[off:off + length])


def find_asset_entries(pe):
    """
    扫描 .rdata，找出所有形如 (key_ptr, key_len, value_ptr, value_len) 的
    phf 条目，并返回 key -> 条目偏移的映射。
    判定依据：key_len 在 1..200，key_ptr 指向的字节是可读的路径字符串，
    且 value_len > 0 且 value_ptr 落在 .rdata 内。
    """
    rd = next(s for s in pe.sections if s['name'] == '.rdata')
    start, size = rd['raddr'], rd['rsize']
    data = pe.data
    entries = {}
    # 条目是 32 字节对齐的连续结构，按 8 字节步进扫描
    for off in range(start, start + size - 32, 8):
        kptr, klen, vptr, vlen = struct.unpack_from('<QQQQ', data, off)
        if not (1 <= klen <= 200):
            continue
        if vlen == 0 or vlen > 50_000_000:
            continue
        try:
            koff = pe.va2off(kptr)
            voff = pe.va2off(vptr)
        except ValueError:
            continue
        if koff < start or koff >= start + size:
            continue
        if voff < start or voff >= start + size:
            continue
        key = bytes(data[koff:koff + klen])
        # key 必须像路径
        if not key.startswith(b'/') or b'\x00' in key:
            continue
        if not all(32 <= b < 127 for b in key):
            continue
        entries[key] = {
            'entry_off': off,
            'key_ptr': kptr, 'key_len': klen,
            'value_ptr': vptr, 'value_len': vlen,
            'key': key.decode('ascii'),
            'value_off': voff,
        }
    return entries


def list_assets(path):
    pe = PE(path)
    entries = find_asset_entries(pe)
    out = []
    for key, e in sorted(entries.items()):
        raw = pe.data[e['value_off']:e['value_off'] + e['value_len']]
        plain = None
        status = 'raw (not brotli)'
        # 原地覆盖后尾部会有 0 填充，brotli 解压器可能报 trailing data，
        # 因此用增量解码器逐段喂入，取能解出的最长前缀。
        try:
            dec = brotli.Decompressor()
            chunk = b''
            for i in range(0, len(raw), 4096):
                try:
                    chunk += dec.process(raw[i:i + 4096])
                except brotli.error:
                    break
            if chunk:
                plain = chunk
                status = f'brotli -> {len(plain)} bytes'
        except Exception:
            pass
        if plain is None:
            plain = bytes(raw)
        out.append({
            'key': key,
            'compressed_len': e['value_len'],
            'plain_len': len(plain),
            'status': status,
            'entry_off': e['entry_off'],
            'value_off': e['value_off'],
        })
    return pe, out


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else r'D:\红果免费短剧\hongguo-desktop-companion.exe'
    pe, assets = list_assets(target)
    print(f'目标: {target}')
    print(f'image_base = {pe.image_base:#x}')
    print(f'发现 {len(assets)} 个资源条目:\n')
    for a in assets:
        print(f"  {a['key']}")
        print(f"      压缩 {a['compressed_len']} -> {a['plain_len']} 字节  ({a['status']})")
        print(f"      entry@{a['entry_off']:#x}  data@{a['value_off']:#x}")
