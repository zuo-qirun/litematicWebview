# 分析 64x64 箱子纹理：按 ModelPart box-UV 布局统计每个面区域里的不透明像素比例
# 用法: python tools/qa/analyze_chest_tex.py            (默认 normal/trapped/ender)
from PIL import Image
import numpy as np
import sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEX = os.path.join(ROOT, '_dl', 'chesttex')

PARTS = (
    # name, (u0, v0), (w, h, d)
    ('lid', (0, 0), (14, 5, 14)),
    ('bottom', (0, 19), (14, 10, 14)),
    ('lock', (0, 0), (2, 4, 1)),
)


def regions(u0, v0, w, h, d, swap_ud=False):
    """返回 {face: (x, y, w, h)}，坐标为 64x64 纹理内像素。
    swap_ud=True 时顶条带左右互换（= up 在左、down 在右），用于对比两种假设。"""
    left, right = (u0 + d, u0 + d + w) if swap_ud else (u0 + d + w, u0 + d)
    r = {}
    r['down'] = (left, v0, w, d)
    r['up'] = (right, v0, w, d)
    r['west'] = (u0, v0 + d, d, h)
    r['north'] = (u0 + d, v0 + d, w, h)
    r['east'] = (u0 + d + w, v0 + d, d, h)
    r['south'] = (u0 + 2 * d + w, v0 + d, w, h)
    return r


def main():
    names = sys.argv[1:] or ['normal', 'trapped', 'ender']
    for name in names:
        path = os.path.join(TEX, name + '.png')
        im = Image.open(path).convert('RGBA')
        a = np.array(im.getchannel('A'))
        print('=== %s (%s) ===' % (name, path))
        for part, (u0, v0), (w, h, d) in PARTS:
            for hyp, swap in (('A(up,down)', False), ('B(down,up)', True)):
                reg = regions(u0, v0, w, h, d, swap)
                if part == 'lock':
                    # 锁扣区域与 lid 完全重叠，两种假设一样，只打一次
                    if hyp != 'A(up,down)':
                        continue
                line = []
                for face in ('up', 'down', 'west', 'north', 'east', 'south'):
                    x, y, rw, rh = reg[face]
                    sub = a[y:y + rh, x:x + rw]
                    op = int((sub == 255).sum())
                    tot = sub.size
                    line.append('%-5s %3d/%3d %s' % (face, op, tot, 'FULL' if op == tot else ('EMPTY' if op == 0 else 'part')))
                print('  %-6s %s : %s' % (part, hyp, '  |  '.join(line)))


if __name__ == '__main__':
    main()
