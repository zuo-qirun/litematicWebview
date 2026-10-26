import sys
sys.path.insert(0, 'tools')
from nbtref import load_litematic
root = load_litematic('tests/fixtures/豪华版mis正式版v1.7.litematic')
regs = root['value']['Regions']
k0 = list(regs.keys())[0]
r = regs[k0]
print('keys', list(r.keys()))
print('pos', r['Position'], 'size', r['Size'])
print('pal0', r['BlockStatePalette'][:2])
print('longs', type(r['BlockStates']), len(r['BlockStates']))
