"""Minimal NBT reader/writer + litematic inspector (reference implementation)."""
import gzip
import struct


class R:
    def __init__(self, b, i=0):
        self.b = b
        self.i = i

    def u1(self):
        v = self.b[self.i]
        self.i += 1
        return v

    def i1(self):
        v = struct.unpack_from('>b', self.b, self.i)[0]
        self.i += 1
        return v

    def i2(self):
        v = struct.unpack_from('>h', self.b, self.i)[0]
        self.i += 2
        return v

    def i4(self):
        v = struct.unpack_from('>i', self.b, self.i)[0]
        self.i += 4
        return v

    def i8(self):
        v = struct.unpack_from('>q', self.b, self.i)[0]
        self.i += 8
        return v

    def f4(self):
        v = struct.unpack_from('>f', self.b, self.i)[0]
        self.i += 4
        return v

    def f8(self):
        v = struct.unpack_from('>d', self.b, self.i)[0]
        self.i += 8
        return v

    def s(self):
        n = struct.unpack_from('>H', self.b, self.i)[0]
        self.i += 2
        v = self.b[self.i:self.i + n].decode('utf-8', 'replace')
        self.i += n
        return v


def payload(r, t):
    if t == 1:
        return r.i1()
    if t == 2:
        return r.i2()
    if t == 3:
        return r.i4()
    if t == 4:
        return r.i8()
    if t == 5:
        return r.f4()
    if t == 6:
        return r.f8()
    if t == 7:
        n = r.i4()
        v = bytes(r.b[r.i:r.i + n])
        r.i += n
        return v
    if t == 8:
        return r.s()
    if t == 9:
        et = r.u1()
        n = r.i4()
        return [payload(r, et) for _ in range(n)]
    if t == 10:
        out = {}
        while True:
            tt = r.u1()
            if tt == 0:
                return out
            nm = r.s()
            out[nm] = payload(r, tt)
    if t == 11:
        n = r.i4()
        return [r.i4() for _ in range(n)]
    if t == 12:
        n = r.i4()
        return [r.i8() for _ in range(n)]
    raise ValueError('unknown tag %r' % t)


def read_nbt(data):
    r = R(data)
    t = r.u1()
    if t != 10:
        raise ValueError('root tag %r' % t)
    name = r.s()
    return {'name': name, 'value': payload(r, 10)}


def load_litematic(path):
    raw = open(path, 'rb').read()
    data = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
    return read_nbt(data)


# --- NBT writer -------------------------------------------------------------
TAG_NAMES = {1: 'i8', 2: 'i16', 3: 'i32', 4: 'i64', 5: 'f32', 6: 'f64',
             7: 'i8[]', 8: 'str', 9: 'list', 10: 'compound', 11: 'i32[]', 12: 'i64[]'}


class W:
    """Tiny NBT writer used to synthesize fixtures."""
    def __init__(self):
        self.b = bytearray()

    def _s(self, s):
        e = s.encode('utf-8')
        self.b += struct.pack('>H', len(e)) + e

    def tag(self, t, name, value):
        self.b.append(t)
        self._s(name)
        self._p(t, value)

    def _p(self, t, v):
        if t == 1:
            self.b += struct.pack('>b', v)
        elif t == 2:
            self.b += struct.pack('>h', v)
        elif t == 3:
            self.b += struct.pack('>i', v)
        elif t == 4:
            self.b += struct.pack('>q', v)
        elif t == 5:
            self.b += struct.pack('>f', v)
        elif t == 6:
            self.b += struct.pack('>d', v)
        elif t == 7:
            self.b += struct.pack('>i', len(v)) + bytes(v)
        elif t == 8:
            self._s(v)
        elif t == 9:
            et, items = v
            self.b.append(et)
            self.b += struct.pack('>i', len(items))
            for it in items:
                self._p(et, it)
        elif t == 10:
            for k, (tt, vv) in v.items():
                self.tag(tt, k, vv)
            self.b.append(0)
        elif t == 11:
            self.b += struct.pack('>i', len(v))
            for x in v:
                self.b += struct.pack('>i', x)
        elif t == 12:
            self.b += struct.pack('>i', len(v))
            for x in v:
                self.b += struct.pack('>q', x)
        else:
            raise ValueError(t)

    def root(self, name, compound):
        self.tag(10, name, compound)
        return bytes(self.b)


def unpack_states(longs, bits, count):
    """Litematica bit packing: values packed contiguously, spilling across longs."""
    out = []
    if bits <= 0:
        return [0] * count
    mask = (1 << bits) - 1
    bitpos = 0
    for _ in range(count):
        b0 = bitpos >> 6
        off = bitpos & 63
        if off + bits <= 64:
            v = (longs[b0] >> off) & mask
        else:
            lo = (longs[b0] >> off) & ((1 << (64 - off)) - 1)
            hi = longs[b0 + 1] & ((1 << (bits - (64 - off))) - 1)
            v = lo | (hi << (64 - off))
        out.append(v)
        bitpos += bits
    return out


def pack_states(values, bits):
    nlongs = (len(values) * bits + 63) // 64
    longs = [0] * nlongs
    bitpos = 0
    for v in values:
        b0 = bitpos >> 6
        off = bitpos & 63
        v &= (1 << bits) - 1
        longs[b0] |= (v << off) & ((1 << 64) - 1)
        if off + bits > 64:
            longs[b0 + 1] |= v >> (64 - off)
        bitpos += bits
    return longs
