#!/usr/bin/env python3
"""Génère les icônes PNG de l'appli (stdlib uniquement) : python3 tools/make-icons.py
Deux silhouettes sur fond violet, dans la zone sûre « maskable » (80 % centraux)."""
import struct, zlib, os

BG, BACK, FRONT = (91, 75, 219), (196, 190, 255), (255, 255, 255)

def ell(cx, cy, rx, ry, clip_y=None):
    def f(x, y):
        if clip_y is not None and y > clip_y: return False
        return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
    return f

def person(cx, head_y, head_r, body_y, rx, ry, grow=0.0):
    head = ell(cx, head_y, head_r + grow, head_r + grow)
    body = ell(cx, body_y, rx + grow, ry + grow, clip_y=body_y)
    return lambda x, y: head(x, y) or body(x, y)

# du fond vers l'avant : personne de derrière, liseré de séparation, personne de devant
LAYERS = [
    (person(0.62, 0.37, 0.10, 0.70, 0.17, 0.17), BACK),
    (person(0.41, 0.40, 0.12, 0.75, 0.22, 0.21, grow=0.028), BG),
    (person(0.41, 0.40, 0.12, 0.75, 0.22, 0.21), FRONT),
]

def render(size, ss=3):
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    x, y = (px + (sx + .5) / ss) / size, (py + (sy + .5) / ss) / size
                    c = BG
                    for shape, col in LAYERS:
                        if shape(x, y): c = col
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            n = ss * ss
            row += bytes((acc[0] // n, acc[1] // n, acc[2] // n))
        rows.append(b'\x00' + bytes(row))
    return b''.join(rows)

def png(size):
    raw = render(size)
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

out = os.path.join(os.path.dirname(__file__), '..', 'public')
for name, size in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180), ('favicon-32.png', 32)]:
    open(os.path.join(out, name), 'wb').write(png(size))
    print('✓', name)
