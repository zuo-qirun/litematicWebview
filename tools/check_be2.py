import sys, glob, os, gzip
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbtref import read_nbt

for p in sorted(glob.glob(r'D:\Github\tempproject\temp\mcviewer\tests\fixtures\*.litematic')):
    with gzip.open(p, 'rb') as f:
        data = f.read()
    root = read_nbt(data)['value']
    regions = root.get('Regions', {})
    print('=' * 78)
    print(os.path.basename(p), 'topkeys=', list(root.keys()))
    for name, r in regions.items():
        be = r.get('TileEntities') or []
        en = r.get('Entities') or []
        tk = r.get('PendingBlockTicks') or []
        pos = r.get('Position'); size = r.get('Size')
        print(f'  region {name!r} keys={list(r.keys())}')
        print(f'    pos={pos} size={size} TE={len(be)} ENT={len(en)} TICK={len(tk)}')
        if be:
            print('    TE[0] keys=', list(be[0].keys()))
            for k, v in be[0].items():
                s = repr(v)
                print('       ', k, '=', s[:300])
        if en:
            print('    ENT[0] keys=', list(en[0].keys()), repr(en[0])[:400])
        if tk:
            print('    TICK[0]=', repr(tk[0])[:300])
