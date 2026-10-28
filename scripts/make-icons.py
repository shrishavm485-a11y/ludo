"""Writes client/public/icons/icon-192.png and icon-512.png (no dependencies). Run: npm run icons"""
import struct, zlib, os

def png(size, path):
    s = size
    px = bytearray()
    cx = lambda f: int(f * s)
    def inside_round(x, y, x0, y0, x1, y1, r):
        if x < x0 or x >= x1 or y < y0 or y >= y1: return False
        dx = max(x0 + r - x, 0, x - (x1 - r - 1)); dy = max(y0 + r - y, 0, y - (y1 - r - 1))
        return dx * dx + dy * dy <= r * r
    pips = [(0.34, 0.34, (230, 50, 50)), (0.66, 0.34, (36, 87, 230)), (0.5, 0.5, (17, 17, 17)), (0.34, 0.66, (31, 168, 79)), (0.66, 0.66, (230, 50, 50))]
    for y in range(s):
        px.append(0)
        for x in range(s):
            c = (255, 209, 0)
            if inside_round(x, y, cx(0.19), cx(0.19), cx(0.81), cx(0.81), cx(0.11)): c = (17, 17, 17)
            if inside_round(x, y, cx(0.19) + s // 50, cx(0.19) + s // 50, cx(0.81) - s // 50, cx(0.81) - s // 50, cx(0.10)): c = (246, 239, 220)
            for fx, fy, col in pips:
                if (x - cx(fx)) ** 2 + (y - cx(fy)) ** 2 <= cx(0.06) ** 2: c = col
            px.extend(c)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', s, s, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(px), 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'client', 'public', 'icons')
os.makedirs(out, exist_ok=True)
png(192, os.path.join(out, 'icon-192.png')); png(512, os.path.join(out, 'icon-512.png'))
print('icons written')
