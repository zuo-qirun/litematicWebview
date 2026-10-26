import sys, os
sys.path.insert(0, 'tools')
from nbtref import load_litematic
sch = load_litematic('tests/fixtures/豪华版mis正式版v1.7.litematic')
print(type(sch), list(sch.keys())[:10] if isinstance(sch, dict) else dir(sch)[:20])
