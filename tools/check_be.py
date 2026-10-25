import sys, glob, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbtref import read_nbt

def get_c(t, k, d=None):
    v = t.get(k)
    return v if v is not None else d

for p in sorted(glob.glob(r'D:\Github\tempproject\temp\mcviewer\tests\fixtures\*.litematic')):
    import gzip
    with gzip.open(p, 'rb') as f:
        data = f.read()
    root = read_nbt(data)
    schem = root['value']
    regions = schem.get('Regions', {})
    print('=' * 70)
    print(os.path.basename(p))
    for name, r in regions.items():
        pos = r.get('Position')
        size = r.get('Size')
        if pos is None or size is None:
            continue
        p3 = (pos['x'], pos['y'], pos['z']) if isinstance(pos, dict) else pos
        s3 = (size['x'], size['y'], size['z']) if isinstance(size, dict) else size
        a3 = tuple(abs(v) for v in s3)
        be = r.get('TileEntities') or []
        en = r.get('Entities') or []
        tk = r.get('PendingBlockTicks') or []
        info = f'  {name!r:28} pos={p3} size={s3}'
        if be:
            xs = [b['Pos'][0] for b in be]
            ys = [b['Pos'][1] for b in be]
            zs = [b['Pos'][2] for b in be]
            info += f'\n      TE n={len(be)} x[{min(xs)},{max(xs)}] y[{min(ys)},{max(ys)}] z[{min(zs)},{max(zs)}] absSize={a3}'
            if be:
                info += f' sample={ {k: v for k, v in be[0].items() if k != "TileNBT"} }'
        if en:
            info += f'\n      ENT n={len(en)} sample={en[0]}'
        if tk:
            info += f'\n      TICK n={len(tk)} sample={tk[0]}'
        print(info)
