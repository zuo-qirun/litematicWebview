#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""mcviewer 材质包烘焙：把用户上传的资源包（zip）叠加到内置资产上，产出一整套
可直接给 BlockDB.load("/packs/<id>/assets/") 使用的 assets 目录。

服务器固定调用方式：
    python tools/bake/pack.py --pack <pack.zip> --out <assetsDir> \
        [--base assets] [--jars _dl/client-1.21.1.jar,_dl/client-26.3.jar] [--verbose]

退出码：0 = 成功（并写 <out>/report.json）；2 = 材质包无效 / 不可烘焙
（也会尽量把中文原因写进 <out>/report.json 的 error 字段）。

设计要点
--------
* 分层资产源（Layer，优先级从高到低）：pack zip > --jars 顺序的第一个 jar > 第二个 jar ...
  与 bake.py 默认行为保持一致（默认 1.21.1 优先于 26.3）。
* 图集布局冻结：先用内置 jar 跑一次"基线烘焙"得到基准图集布局（layout），再叠材质包；
  包内覆盖的纹理是"替换同名纹理的既有 UV 区像素"（不改变 uv，不破坏未覆盖方块）；
  包内新增的纹理才追加到空闲区，空闲区不够时 2 倍放大兜底。
* 复用的 bake.py 能力：blockstates variants/multipart、model parent 链、#纹理变量、
  elements/faces/uv/rotation/tintindex、blockstate x/y/uvlock 旋转展开、动画纹理首帧、
  render(opaque/cutout/translucent) 推断、tint 颜色表、lang 生成、meta 统计。
* 烘焙完成后，如果 tools/bake/post_entity_models.py 存在，自动执行一次
  `python tools/bake/post_entity_models.py --out <out>`（继承箱子等实体模型修复）。
"""
import argparse
import collections
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

from PIL import Image
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
for _p in (ROOT, HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import bake  # noqa: E402  （复用烘培器；只调用其公开函数，不改变默认行为）

DEFAULT_JARS = '_dl/client-1.21.1.jar,_dl/client-26.3.jar'
DEFAULT_BASE = 'assets'
WORK_DIR = os.path.join(ROOT, '_dl', '_work_pack')
REPORT_NAME = 'report.json'

ASSET_HEAD = 'assets/minecraft/'
OFFICIAL_DIRS = {
    'blockstates': ASSET_HEAD + 'blockstates/',
    'models': ASSET_HEAD + 'models/',
    'textures': ASSET_HEAD + 'textures/',
    'lang': ASSET_HEAD + 'lang/',
}


class PackError(Exception):
    """材质包无效 / 不可烘焙（退出码 2，error 原样展示给用户）。"""


def _abs(p):
    if p is None:
        return None
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


def _norm_key(name):
    """规范化条目名：反斜杠->斜杠、去空段/./、统一小写（大小写不敏感）。"""
    s = name.replace('\\', '/').strip()
    parts = [p for p in s.split('/') if p not in ('', '.')]
    return '/'.join(parts).lower()


# 老版本（1.12 及更早）资源包用复数目录名；只映射 minecraft 的 textures/ 子目录
LEGACY_TEXTURE_DIRS = (
    ('blocks/', 'block/'),
    ('items/', 'item/'),
)

# --jars 里读不到 version.json 时兜底：1.21.1 的资源包格式
BASE_PACK_FORMAT_FALLBACK = 34


def texture_key_to_name(key):
    """资源条目 key（assets/minecraft/textures/block/stone.png）→ 图集纹理名（block/stone）。

    * 容忍有没有 assets/minecraft/ 前缀、有没有 .png 后缀、大小写差异；
    * 老版本路径别名：textures/blocks/ -> textures/block/、textures/items/ -> textures/item/。
    """
    k = _norm_key(key)
    head = ASSET_HEAD + 'textures/'
    if k.startswith(head):
        k = k[len(head):]
    elif head in k:
        k = k.split(head, 1)[1]
    elif k.startswith('textures/'):
        k = k[len('textures/'):]
    if k.endswith('.png'):
        k = k[:-len('.png')]
    for old, new in LEGACY_TEXTURE_DIRS:
        if k.startswith(old):
            k = new + k[len(old):]
            break
    return k


def _alias_asset_key(key):
    """把老版本纹理路径映射到现代路径（其余条目原样返回）。"""
    for old, new in LEGACY_TEXTURE_DIRS:
        prefix = ASSET_HEAD + 'textures/' + old
        if key.startswith(prefix):
            return ASSET_HEAD + 'textures/' + new + key[len(prefix):]
    return key


# ---------------------------------------------------------------------------
# 分层资产源：pack zip > jar1 > jar2 ...
# ---------------------------------------------------------------------------
class JarLayer(object):
    def __init__(self, path):
        if not os.path.isfile(path):
            raise PackError('找不到客户端 jar：%s（请确认 --jars 参数）' % path)
        try:
            self.zip = zipfile.ZipFile(path)
        except Exception as exc:
            raise PackError('无法打开客户端 jar：%s（%s）' % (path, exc))
        self.files = {}
        for name in self.zip.namelist():
            if name.endswith('/'):
                continue
            self.files[_norm_key(name)] = name

    def read(self, key):
        raw_name = self.files.get(key)
        if raw_name is None:
            return None
        return self.zip.read(raw_name)

    def close(self):
        try:
            self.zip.close()
        except Exception:
            pass


class PackLayer(object):
    """资源包 zip：只关心 assets/minecraft/ 下的内容；允许外面套一层目录。"""

    def __init__(self, path):
        self.path = path
        if not os.path.isfile(path):
            raise PackError('找不到材质包文件：%s' % path)
        try:
            self.zip = zipfile.ZipFile(path)
        except Exception as exc:
            raise PackError('不是有效的 zip 材质包：%s（%s）' % (path, exc))
        self.files = {}          # 规范 key（小写、assets/minecraft/... 开头）-> ZipInfo
        self.ignored = 0         # 非 minecraft 资源的条目数（pack.mcmeta / __MACOSX / 别的命名空间等）
        self.raw_entries = 0
        self.aliased = []        # 老版本路径（textures/blocks/ 等）映射后的纹理名
        self.skipped = []        # 无法使用而被跳过的文件 (key, 原因)
        self.bad_json = set()    # 读取阶段发现解析失败的 JSON key（避免重复记录）
        for info in self.zip.infolist():
            if info.filename.endswith('/'):
                continue
            self.raw_entries += 1
            norm = info.filename.replace('\\', '/')
            if norm.startswith('/') or re.match(r'^[A-Za-z]:', norm):
                raise PackError('材质包内含绝对路径条目，已拒绝：%s' % info.filename)
            parts = [p for p in norm.split('/') if p not in ('', '.')]
            if any(p == '..' for p in parts):
                raise PackError('材质包内含路径穿越条目（..），已拒绝：%s' % info.filename)
            low = [p.lower() for p in parts]
            if '__macosx' in low:
                continue
            try:
                idx = low.index('assets')
            except ValueError:
                self.ignored += 1
                continue
            if idx + 1 >= len(low) or low[idx + 1] != 'minecraft':
                self.ignored += 1
                continue
            key = '/'.join(low[idx:])
            if not key.startswith(ASSET_HEAD):
                self.ignored += 1
                continue
            alias = _alias_asset_key(key)
            if alias != key:
                self.aliased.append(texture_key_to_name(alias))
                key = alias
            self.files.setdefault(key, info)
        # 分类（保持排序，保证可重复）
        def _list(prefix, suffix):
            return sorted(k for k in self.files if k.startswith(prefix) and k.endswith(suffix))

        self.blockstates = _list(OFFICIAL_DIRS['blockstates'], '.json')
        self.models = _list(OFFICIAL_DIRS['models'], '.json')
        self.textures = _list(OFFICIAL_DIRS['textures'], '.png')
        self.lang = _list(OFFICIAL_DIRS['lang'], '.json')
        self.mcmeta = self._read_pack_meta()
        self._validate_json_files()
        self._validate_textures()

    # -- 读取 --
    def read(self, path):
        key = _norm_key(path)
        info = self.files.get(key)
        return self.zip.read(info) if info is not None else None

    def _validate_json_files(self):
        bad = []
        for key in self.blockstates + self.models + self.lang:
            raw = self.read(key)
            try:
                obj = json.loads(raw.decode('utf-8-sig'))
            except Exception as exc:
                bad.append((key, 'JSON 无法解析：%s' % exc))
                continue
            if not isinstance(obj, dict):
                bad.append((key, '顶层必须是对象'))
        if bad:
            # 单个坏文件不足以让整包失败：跳过它，让其余覆盖照常生效
            self.skipped.extend(bad)
            drop = set(k for k, _ in bad)
            self.blockstates = [k for k in self.blockstates if k not in drop]
            self.models = [k for k in self.models if k not in drop]
            self.lang = [k for k in self.lang if k not in drop]

    def _validate_textures(self):
        bad = []
        good = []
        for key in self.textures:
            raw = self.read(key)
            try:
                im = Image.open(io.BytesIO(raw))
                im.load()
            except Exception as exc:
                bad.append((key, 'PNG 无法解码：%s' % exc))
                continue
            good.append(key)
        if bad:
            self.skipped.extend(bad)
            self.textures = good

    def _read_pack_meta(self):
        """解析 pack.mcmeta（容错 BOM / 大小写 / 外层目录）。

        返回 dict：found / packFormat / supportedFormats([lo,hi] 或 None) / description / error。
        解析失败不抛异常（只记 error），因为包内容本身仍可能可用。
        """
        out = collections.OrderedDict([
            ('found', False), ('packFormat', None), ('supportedFormats', None),
            ('description', ''), ('error', ''),
        ])
        cands = []
        for info in self.zip.infolist():
            if info.filename.endswith('/'):
                continue
            parts = [p for p in info.filename.replace('\\', '/').split('/')
                     if p not in ('', '.')]
            if parts and parts[-1].lower() == 'pack.mcmeta':
                cands.append((len(parts), info))
        if not cands:
            return out
        cands.sort(key=lambda t: t[0])      # 优先外层（层级最浅）的 pack.mcmeta
        info = cands[0][1]
        out['found'] = True
        try:
            doc = json.loads(self.zip.read(info).decode('utf-8-sig'))
        except Exception as exc:
            out['error'] = 'pack.mcmeta 无法解析：%s' % exc
            return out
        pack = doc.get('pack') if isinstance(doc, dict) else None
        if not isinstance(pack, dict):
            out['error'] = 'pack.mcmeta 缺少 pack 对象'
            return out

        desc = pack.get('description')
        if isinstance(desc, str):
            out['description'] = desc
        elif isinstance(desc, dict):        # 1.21+ 允许 {"text": ...} / {"translate": ...}
            out['description'] = str(desc.get('text') or desc.get('translate') or '')

        def _int(v):
            return v if isinstance(v, int) and not isinstance(v, bool) else None

        fmt = _int(pack.get('pack_format'))
        lo = hi = None
        sf = pack.get('supported_formats')
        if isinstance(sf, int) and not isinstance(sf, bool):
            lo = hi = sf
        elif isinstance(sf, (list, tuple)) and len(sf) == 2:      # [min, max]
            lo, hi = _int(sf[0]), _int(sf[1])
        elif isinstance(sf, dict):                                 # {min_inclusive, max_inclusive}
            lo = _int(sf.get('min_inclusive'))
            hi = _int(sf.get('max_inclusive'))
            if lo is None:
                lo = _int(sf.get('min_format'))
            if hi is None:
                hi = _int(sf.get('max_format'))
        if lo is None:
            lo = _int(pack.get('min_format'))
        if hi is None:
            hi = _int(pack.get('max_format'))
        if lo is None and fmt is not None:
            lo = fmt
        if hi is None and fmt is not None:
            hi = fmt
        out['packFormat'] = fmt
        if lo is not None and hi is not None:
            out['supportedFormats'] = [lo, hi]
        return out

    def close(self):
        try:
            self.zip.close()
        except Exception:
            pass


class LayeredSource(object):
    """把 pack / jar 多层包装成 bake.build() 需要的 AssetSource 形状。

    layers 顺序即优先级；layers[0] 是 pack（可为 None）。
    """

    def __init__(self, layers, verbose=False):
        self.layers = [l for l in layers if l is not None]
        self.verbose = verbose

    # -- AssetSource 接口（bake.py / ModelResolver 使用） --
    def has(self, path):
        key = _norm_key(path)
        return any(key in layer.files for layer in self.layers)

    def read(self, path, default=None):
        key = _norm_key(path)
        for layer in self.layers:
            raw = layer.read(key)
            if raw is not None:
                return raw
        return default

    def json(self, path, default=None):
        key = _norm_key(path)
        for layer in self.layers:
            raw = layer.read(key)
            if raw is None:
                continue
            try:
                return json.loads(raw.decode('utf-8-sig'))
            except Exception as exc:
                if isinstance(layer, PackLayer):
                    if key not in layer.bad_json:
                        layer.bad_json.add(key)
                        layer.skipped.append((key, 'JSON 无法解析：%s' % exc))
                    continue  # 跳过坏文件，回退到下一层（客户端 jar）
                raise
        return default

    def list(self, prefix, suffix=''):
        pre = _norm_key(prefix)
        suf = suffix.lower()
        keys = set()
        for layer in self.layers:
            for k in layer.files:
                if k.startswith(pre) and k.endswith(suf):
                    keys.add(k)
        return sorted(keys)

    def close(self):
        for layer in self.layers:
            layer.close()


# ---------------------------------------------------------------------------
# 图集：基准布局冻结 + 覆盖像素替换 + 新纹理追加
# ---------------------------------------------------------------------------
def _paste_padded(atlas, im, cell, padding):
    """把 im 贴到 cell=(x,y,w,h)，边缘 padding 像素复制（与 bake.pack_atlas 一致）。"""
    x, y, w, h = cell
    atlas.paste(im, (x, y))
    if padding:
        left = im.crop((0, 0, 1, h)).resize((padding, h), Image.NEAREST)
        right = im.crop((w - 1, 0, w, h)).resize((padding, h), Image.NEAREST)
        atlas.paste(left, (x - padding, y))
        atlas.paste(right, (x + w, y))
        top = atlas.crop((x - padding, y, x + w + padding, y + 1)).resize(
            (w + 2 * padding, padding), Image.NEAREST)
        bot = atlas.crop((x - padding, y + h - 1, x + w + padding, y + h)).resize(
            (w + 2 * padding, padding), Image.NEAREST)
        atlas.paste(top, (x - padding, y - padding))
        atlas.paste(bot, (x - padding, y + h))


class FrozenLayoutAtlas(object):
    """bake.build() 的 atlas_fn 扩展点。

    entries 来自 bake.build()（已按纹理名排序、动画纹理已截首帧、末尾含 __missing__）。
    * 基准布局里的纹理：若材质包提供了同名纹理，则原地替换像素（尺寸不同则缩放到原 cell）；
    * 基准布局里没有的新纹理：找空闲矩形追加，必要时图集 2 倍放大兜底。
    """

    def __init__(self, base_atlas, base_place, base_size, padding=2,
                 overrides=None, verbose=False, max_size=4096):
        self.base_atlas = base_atlas
        self.base_place = dict(base_place)
        self.base_size = base_size
        self.padding = padding
        self.overrides = set(overrides or ())
        self.verbose = verbose
        self.max_size = max_size
        self.size = base_size
        self.pasted = set()       # 真正被替换像素的覆盖纹理
        self.appended = collections.OrderedDict()   # 新纹理 -> 图集 cell (x,y,w,h)
        self.resized = set()      # 尺寸与基准 cell 不一致、被缩放过的纹理
        self.grown = False
        self.usage = 0.0

    # -- 占用图 --
    def _mask(self, atlas, place):
        S = atlas.width
        mask = np.zeros((S, S), dtype=bool)
        alpha = np.asarray(atlas.getchannel('A'))
        mask |= (alpha > 0)
        p = self.padding
        for (x, y, w, h) in place.values():
            x0, y0 = max(0, x - p), max(0, y - p)
            x1, y1 = min(S, x + w + p), min(S, y + h + p)
            mask[y0:y1, x0:x1] = True
        return mask

    def _mark(self, mask, cell):
        S = mask.shape[0]
        x, y, w, h = cell
        p = self.padding
        mask[max(0, y - p):min(S, y + h + p),
             max(0, x - p):min(S, x + w + p)] = True

    @staticmethod
    def _find_free(mask, size, padding):
        S = mask.shape[0]
        w, h = size
        if w + 2 * padding > S or h + 2 * padding > S:
            return None
        ii = np.zeros((S + 1, S + 1), dtype=np.int32)
        ii[1:, 1:] = mask.astype(np.int32).cumsum(0).cumsum(1)
        xs = np.arange(padding, S - w - padding + 1)
        ys = np.arange(padding, S - h - padding + 1)
        if xs.size == 0 or ys.size == 0:
            return None
        a = ii[np.ix_(ys + h, xs + w)] - ii[np.ix_(ys, xs + w)] \
            - ii[np.ix_(ys + h, xs)] + ii[np.ix_(ys, xs)]
        z = np.argwhere(a == 0)
        if z.size == 0:
            return None
        y, x = int(z[0][0]), int(z[0][1])
        return (int(xs[x]), int(ys[y]), w, h)

    def _grow(self, atlas, place):
        S = atlas.width
        if S * 2 > self.max_size:
            raise PackError('材质包新增纹理过多：图集放大到 %d×%d 仍放不下'
                            % (S * 2, S * 2))
        if self.verbose:
            print('  [atlas] 空闲区不足，图集放大 %d -> %d' % (S, S * 2))
        new_atlas = atlas.resize((S * 2, S * 2), Image.NEAREST)
        new_place = dict((k, (x * 2, y * 2, w * 2, h * 2))
                         for k, (x, y, w, h) in place.items())
        self.grown = True
        return new_atlas, new_place

    def __call__(self, entries, padding, min_size, max_size):
        if min_size > self.base_size:
            raise PackError('图集最小尺寸参数（%d）大于基准图集尺寸（%d），无法烘焙'
                            % (min_size, self.base_size))
        padding = self.padding          # 基准布局的 padding 恒为 2
        atlas = self.base_atlas.copy()
        place = dict(self.base_place)   # 基准布局：所有内置纹理 cell（含 __missing__）
        entry_map = collections.OrderedDict(entries)

        # 1) 覆盖：同名纹理 -> 原地替换像素（保持 uv 不变）
        for tex, im in entries:
            cell = place.get(tex)
            if cell is None or tex not in self.overrides:
                continue
            if im.size != (cell[2], cell[3]):
                im = im.resize((cell[2], cell[3]), Image.NEAREST)
                self.resized.add(tex)
            _paste_padded(atlas, im, cell, padding)
            self.pasted.add(tex)

        # 2) 追加：基准布局里没有的新纹理 -> 空闲区
        extras = [(tex, im) for tex, im in entries if tex not in self.base_place]
        if extras:
            mask = self._mask(atlas, place)
            for tex, im in extras:
                cell = self._find_free(mask, im.size, padding)
                while cell is None:
                    atlas, place = self._grow(atlas, place)
                    mask = self._mask(atlas, place)
                    cell = self._find_free(mask, im.size, padding)
                _paste_padded(atlas, im, cell, padding)
                place[tex] = cell
                self._mark(mask, cell)
                self.appended[tex] = cell
                if self.verbose:
                    print('  [atlas] 新增纹理 %s %dx%d @ (%d,%d)'
                          % (tex, cell[2], cell[3], cell[0], cell[1]))

        self.size = atlas.width
        cells = list(place.values())
        self.usage = sum((w + 2 * padding) * (h + 2 * padding) for (x, y, w, h) in cells) \
            / float(self.size * self.size)
        return atlas, place, self.size, self.usage


# ---------------------------------------------------------------------------
# lang 合并
# ---------------------------------------------------------------------------
def _read_json_file(path, what):
    try:
        with open(path, 'r', encoding='utf-8-sig') as fh:
            return json.load(fh)
    except Exception as exc:
        raise PackError('无法读取%s：%s（%s）' % (what, path, exc))


def _lang_long_keys(obj):
    out = {}
    if not isinstance(obj, dict):
        return out
    for k, v in obj.items():
        if not isinstance(k, str) or not isinstance(v, str):
            continue
        if k.startswith('block.minecraft.'):
            out[k] = v
        elif k.startswith('block.'):
            out['block.minecraft.' + k[len('block.'):]] = v
    return out


def merge_lang(base_lang, pack):
    """返回 (en_block, zh_block, 覆盖键集合)。只合并 block.minecraft.* / block.* 键。"""
    en_block = _lang_long_keys((base_lang or {}).get('en_us'))
    zh_block = _lang_long_keys((base_lang or {}).get('zh_cn'))
    covered = set()
    if pack is not None:
        for fname, dst in (('en_us', en_block), ('zh_cn', zh_block)):
            raw = pack.read(ASSET_HEAD + 'lang/%s.json' % fname)
            if raw is None:
                continue
            try:
                obj = json.loads(raw.decode('utf-8-sig'))
            except Exception as exc:
                raise PackError('材质包语言文件无法解析：%s（%s）' % (fname, exc))
            if not isinstance(obj, dict):
                raise PackError('材质包语言文件顶层必须是对象：%s' % fname)
            keys = _lang_long_keys(obj)
            dst.update(keys)
            covered |= set(keys)
    return en_block, zh_block, covered


# ---------------------------------------------------------------------------
# 版本兼容（pack.mcmeta）、产物 manifest / 模型分片自检
# ---------------------------------------------------------------------------
def _jar_pack_formats(jarpaths):
    """从客户端 jar 的 version.json 读资源包格式号（pack_version.resource）。

    1.21.x 是整数 resource；26.x 起是 resource_major/resource_minor（如 97.1），
    比较时取 major 即可（只用于提示版本差距，不追求精确）。
    """
    out = []
    for path in jarpaths:
        try:
            with zipfile.ZipFile(path) as z:
                raw = z.read('version.json')
            doc = json.loads(raw.decode('utf-8-sig'))
        except Exception:
            continue
        if not isinstance(doc, dict):
            continue
        pv = doc.get('pack_version') or {}
        res = None
        if isinstance(pv, dict):
            res = pv.get('resource')
            if not isinstance(res, int) or isinstance(res, bool):
                major = pv.get('resource_major')
                res = major if isinstance(major, int) and not isinstance(major, bool) else None
        if isinstance(res, int):
            out.append(collections.OrderedDict([
                ('jar', os.path.basename(path)),
                ('mc', str(doc.get('id') or doc.get('name') or '?')),
                ('resource', res),
            ]))
    return out


def check_pack_compat(pack_meta, jarpaths):
    """pack.mcmeta 与内置基准 jar 的版本兼容性检查。返回 (warnings, info)。

    只告警不拒绝：用户拿新版本的包覆盖老版本资产是合法用法，但值得提示
    "包里只有新版本才有的东西不会被应用"。
    """
    warnings = []
    jar_formats = _jar_pack_formats(jarpaths)
    base_fmt = jar_formats[0]['resource'] if jar_formats else BASE_PACK_FORMAT_FALLBACK
    base_mc = jar_formats[0]['mc'] if jar_formats else '1.21.1'
    fmt = pack_meta.get('packFormat')
    supported = pack_meta.get('supportedFormats')
    if supported is None and isinstance(fmt, int):
        supported = [fmt, fmt]
    info = collections.OrderedDict([
        ('found', bool(pack_meta.get('found'))),
        ('packFormat', fmt),
        ('supportedFormats', supported),
        ('description', pack_meta.get('description') or ''),
        ('error', pack_meta.get('error') or ''),
        ('baseFormats', [dict(f) for f in jar_formats]),
        ('compatible', None),
    ])
    if not pack_meta.get('found'):
        warnings.append('材质包缺少 pack.mcmeta：无法确认它面向的 MC 版本，按「只覆盖同名资产」处理')
        return warnings, info
    if info['error']:
        warnings.append('%s；无法确认它面向的 MC 版本，按未知版本处理' % info['error'])
        return warnings, info
    if supported is None:
        warnings.append('pack.mcmeta 未声明 pack_format / supported_formats：无法确认它面向的 MC 版本')
        return warnings, info
    lo, hi = supported
    span = ('pack_format=%d' % lo) if lo == hi else ('supported_formats=%d~%d' % (lo, hi))
    info['compatible'] = lo <= base_fmt <= hi
    if info['compatible']:
        return warnings, info
    if hi < base_fmt:
        warnings.append('材质包面向更老的 MC 版本（%s，内置基准 %s 为 %d）：老版本纹理路径'
                        '（textures/blocks/ 等）已自动映射到现代路径，但内容可能与内置版本不一致'
                        % (span, base_mc, base_fmt))
        return warnings, info
    extra = ''
    if len(jar_formats) > 1:
        extra = '；%s 客户端 jar（资源格式 %d）可作为兜底，但包内仅新版本才有的内容仍不会被使用' % (
            jar_formats[1]['mc'], jar_formats[1]['resource'])
    warnings.append('材质包面向比内置基准更新的 MC 版本（%s，内置基准 %s 为 %d）：新版本才有的'
                    '纹理/模型不会被应用，缺纹理方块会回退到占位图%s'
                    % (span, base_mc, base_fmt, extra))
    return warnings, info


def ensure_manifest_and_shards(out_dir, base_dir, notes, warnings, verbose=False):
    """保证产物 manifest 与 base 同构、models/ 分片齐全且 modelsCount 与实际一致。

    viewer（src/render/db.js）在 manifest.modelsMode='files' 时会按
    `<编码模型 id>.json` 逐个拉取；只要有一个分片 404 就整体回退到 9MB 的
    models.json，所以后处理脚本新增/修改模型后必须同步分片与 modelsCount。
    """
    out_dir = _abs(out_dir)
    man_path = os.path.join(out_dir, 'manifest.json')
    manifest = _json_load(man_path, {}) or {}
    base_manifest = _json_load(os.path.join(_abs(base_dir), 'manifest.json'), {}) or {}
    info = collections.OrderedDict([
        ('modelsMode', manifest.get('modelsMode')),
        ('modelsDir', manifest.get('modelsDir')),
        ('modelsCount', manifest.get('modelsCount')),
        ('repairedShards', 0),          # 缺失、已补写
        ('syncedShards', 0),            # 存在但内容与 models.json 不一致、已重写
        ('removedStaleShards', 0),      # models.json 已无对应模型、已清理
        ('missingFromBase', []),
        ('diffFromBase', collections.OrderedDict()),
    ])
    # 1) 与 base manifest 同构：base 有而产物缺的顶层键补上（viewer 依赖这些字段）
    for key, val in base_manifest.items():
        if key not in manifest:
            manifest[key] = val
            info['missingFromBase'].append(key)
    if not manifest.get('modelsMode'):
        manifest['modelsMode'] = 'files'
    if not manifest.get('modelsDir'):
        manifest['modelsDir'] = 'models'
    doc = _json_load(os.path.join(out_dir, 'models.json'), {}) or {}
    models = doc.get('models') or {}
    models_dir = os.path.join(out_dir, manifest['modelsDir'])
    if manifest.get('modelsMode') == 'files':
        os.makedirs(models_dir, exist_ok=True)
        keep = {}
        for mid, entry in models.items():
            name = bake.model_file_name(mid)
            if name in keep:
                raise PackError('模型文件名冲突：%s 与 %s 都编码为 %s'
                                % (keep[name], mid, name))
            keep[name] = mid
            path = os.path.join(models_dir, name + '.json')
            want = entry.get('quads') or []
            had = _json_load(path, None)
            if had == want:
                continue
            # 契约：分片内容是 quad 数组（与 bake.py 拆分产物一致）
            bake.write_json(path, want)
            if had is None:
                info['repairedShards'] += 1
            else:
                info['syncedShards'] += 1
        for name in os.listdir(models_dir):
            if not name.endswith('.json') or name[:-len('.json')] in keep:
                continue
            try:
                os.remove(os.path.join(models_dir, name))
                info['removedStaleShards'] += 1
            except OSError:
                pass
        if info['repairedShards']:
            notes.append('补齐 %d 个缺失的模型分片（后处理新增模型后同步）'
                         % info['repairedShards'])
        if info['syncedShards']:
            notes.append('修正 %d 个模型分片内容（与 models.json 不一致）' % info['syncedShards'])
        if info['removedStaleShards']:
            notes.append('清理 %d 个已失效的模型分片（models.json 已无对应模型）'
                         % info['removedStaleShards'])
        count = len(keep)
        if manifest.get('modelsCount') != count:
            before = manifest.get('modelsCount')
            manifest['modelsCount'] = count
            notes.append('manifest.modelsCount 已同步为实际分片数 %d（原 %r）' % (count, before))
        info['modelsMode'] = manifest['modelsMode']
        info['modelsDir'] = manifest['modelsDir']
        info['modelsCount'] = count
        bake.write_json(man_path, manifest)
    # 2) 与 base manifest 关键字段比对（写进 report 便于排查）
    for key in ('format', 'modelsMode', 'modelsDir', 'textureScale', 'atlas', 'files'):
        b, p = base_manifest.get(key), manifest.get(key)
        if b != p:
            info['diffFromBase'][key] = collections.OrderedDict([('base', b), ('pack', p)])
    if info['diffFromBase']:
        warnings.append('产物 manifest 与内置 base 的字段不一致：%s'
                        % ', '.join(info['diffFromBase']))
    if verbose:
        print('[pack] manifest：modelsMode=%s modelsDir=%s modelsCount=%s'
              '（补 %d / 修正 %d / 清理 %d 个分片）'
              % (info['modelsMode'], info['modelsDir'], info['modelsCount'],
                 info['repairedShards'], info['syncedShards'], info['removedStaleShards']))
    return info


# ---------------------------------------------------------------------------
# 基线烘焙
# ---------------------------------------------------------------------------：拿到"内置 jars 下的基准图集布局"（不受材质包影响）
# ---------------------------------------------------------------------------
def bake_baseline(jarpaths, atlas_min, verbose):
    os.makedirs(WORK_DIR, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='baseline-', dir=WORK_DIR)
    try:
        if verbose:
            print('[pack] 基线烘焙（内置 jar -> 基准图集布局）...')
        res = bake.build(jarpaths, tmp, atlas_min=atlas_min,
                         lang_pair=({}, {}),        # 基线不需要 lang，避免联网
                         verbose=False, write_atlas_index=False)
        at = res['atlas']
        atlas_png = os.path.join(tmp, 'atlas.png')
        if not os.path.isfile(atlas_png):
            raise PackError('基线烘焙未生成 atlas.png')
        atlas = Image.open(atlas_png)
        atlas.load()
        atlas = atlas.convert('RGBA')
        return atlas, dict(at['place']), int(at['size'])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# 输出目录处理 / 报告
# ---------------------------------------------------------------------------
def check_out_dir(out_dir, base_dir):
    """返回 (allowed, reason)。禁止写入内置 assets 与项目根目录。"""
    out_real = os.path.realpath(_abs(out_dir))
    base_real = os.path.realpath(_abs(base_dir))
    root_real = os.path.realpath(ROOT)
    if out_real == base_real or out_real.startswith(base_real + os.sep):
        return False, ('拒绝写入内置资产目录：%s；--out 必须是一个新的产物目录'
                       '（例如 data/packs/<id>/assets）' % out_dir)
    if out_real == root_real:
        return False, '拒绝把项目根目录当作 --out 输出目录：%s' % out_dir
    return True, ''


def prepare_out_dir(out_dir):
    """自清理：若目录存在且看起来是 assets 产物目录则清空，否则报错（避免误删用户数据）。"""
    out_dir = _abs(out_dir)
    if os.path.exists(out_dir):
        if not os.path.isdir(out_dir):
            raise PackError('--out 指向的是文件而不是目录：%s' % out_dir)
        names = os.listdir(out_dir)
        if names:
            marks = ('manifest.json', 'meta.json', REPORT_NAME)
            if not any(os.path.isfile(os.path.join(out_dir, n)) for n in marks):
                raise PackError('输出目录非空且不像 mcviewer 资产目录，为避免误删已中止：%s'
                                % out_dir)
            for name in names:
                p = os.path.join(out_dir, name)
                if os.path.isdir(p) and not os.path.islink(p):
                    shutil.rmtree(p)
                else:
                    os.remove(p)
    else:
        os.makedirs(out_dir, exist_ok=True)


def write_report(out_dir, obj):
    path = os.path.join(_abs(out_dir), REPORT_NAME)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    return path


def _json_load(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            return json.load(fh)
    except Exception:
        return default


def _file_info(path):
    try:
        return {'bytes': os.path.getsize(path)}
    except Exception:
        return {}


def collect_stats(out_dir, manifest):
    blocks = _json_load(os.path.join(out_dir, 'blocks.json'), {}).get('blocks', {})
    models = _json_load(os.path.join(out_dir, 'models.json'), {}).get('models', {})
    quads = 0
    for m in models.values():
        quads += len(m.get('quads') or [])
    meta = _json_load(os.path.join(out_dir, 'meta.json'), {}) or {}
    textures = meta.get('textureCount')
    if not isinstance(textures, int):
        texs = set()
        for m in models.values():
            for q in (m.get('quads') or []):
                if q.get('tex'):
                    texs.add(q['tex'])
        textures = len(texs) - (1 if bake.MISSING_TEX in texs else 0)
    atlas = (manifest or {}).get('atlas') or {}
    return {
        'blocks': len(blocks),
        'models': len(models),
        'quads': quads,
        'textures': textures,
        'atlasSize': atlas.get('size'),
        'atlasUsage': meta.get('atlasUsage'),
    }


# ---------------------------------------------------------------------------
# 实体模型后处理（可选继承）
# ---------------------------------------------------------------------------
def run_post_entity_models(out_dir, notes, verbose):
    script = os.path.join(HERE, 'post_entity_models.py')
    if not os.path.isfile(script):
        notes.append('未执行实体模型后处理：tools/bake/post_entity_models.py 不存在')
        return {'applied': False, 'reason': 'missing'}
    # 后处理脚本可能半途失败：先快照 4 个产物文件，失败则回滚，保证材质包本身可用
    snapshot = {}
    for name in ('blocks.json', 'models.json', 'atlas.png', 'meta.json'):
        p = os.path.join(out_dir, name)
        try:
            with open(p, 'rb') as fh:
                snapshot[name] = fh.read()
        except Exception:
            pass
    t0 = time.time()
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'utf-8'
    cmd = [sys.executable, '-X', 'utf8', script, '--out', os.path.abspath(out_dir)]
    if verbose:
        cmd.append('--verbose')
    try:
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                             encoding='utf-8', errors='replace', timeout=180,
                             env=env)
    except subprocess.TimeoutExpired:
        notes.append('实体模型后处理超时（>180s），已回滚，材质包按未修复实体模型输出')
        _restore(out_dir, snapshot)
        return {'applied': False, 'reason': 'timeout'}
    except Exception as exc:
        notes.append('实体模型后处理无法执行：%s，已回滚' % exc)
        _restore(out_dir, snapshot)
        return {'applied': False, 'reason': 'exception'}
    elapsed = int(round((time.time() - t0) * 1000))
    if res.returncode != 0:
        detail = (res.stderr or res.stdout or '').strip().splitlines()
        detail = detail[-1] if detail else '未知错误'
        notes.append('实体模型后处理失败（材质包仍可用）：%s' % detail)
        _restore(out_dir, snapshot)
        return {'applied': False, 'reason': 'failed', 'error': detail,
                'elapsedMs': elapsed}
    notes.append('已执行 tools/bake/post_entity_models.py：继承箱子/陷阱箱/末影箱实体模型')
    return {'applied': True, 'elapsedMs': elapsed}


def _restore(out_dir, snapshot):
    for name, data in snapshot.items():
        try:
            with open(os.path.join(out_dir, name), 'wb') as fh:
                fh.write(data)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def run(args):
    t_start = time.time()
    verbose = bool(getattr(args, 'verbose', False))
    out_dir = _abs(args.out)
    base_dir = _abs(args.base)
    pack_path = _abs(args.pack)

    notes = []
    warnings = []
    allowed, reason = check_out_dir(out_dir, base_dir)
    if not allowed:
        raise PackError(reason)
    prepare_out_dir(out_dir)

    # -- 读取材质包（先做结构与安全校验）--
    pack = PackLayer(pack_path)
    layers = [pack]
    jarpaths = [j.strip() for j in (args.jars or '').split(',') if j.strip()]
    jarpaths = [_abs(j) for j in jarpaths]
    if not jarpaths:
        raise PackError('必须提供至少一个客户端 jar（--jars）')
    for j in jarpaths:
        layers.append(JarLayer(j))
    src = LayeredSource(layers, verbose=verbose)
    if verbose:
        print('[pack] %s' % os.path.basename(pack_path))
        print('  命中 blockstates=%d models=%d textures=%d lang=%d（忽略其他条目 %d）'
              % (len(pack.blockstates), len(pack.models), len(pack.textures),
                 len(pack.lang), pack.ignored))

    # -- 版本兼容检查（只看 pack.mcmeta，告警不拒绝）--
    compat_warnings, compat = check_pack_compat(pack.mcmeta or {}, jarpaths)
    warnings.extend(compat_warnings)
    if pack.aliased:
        notes.append('材质包内 %d 个老版本纹理路径已映射到现代路径'
                     '（textures/blocks/ -> textures/block/ 等）：%s'
                     % (len(pack.aliased), ', '.join(pack.aliased[:6])))

    # -- 基准图集布局（来自内置 jar，与材质包无关）--
    base_manifest = _json_load(os.path.join(base_dir, 'manifest.json'), {}) or {}
    atlas_min = int((base_manifest.get('atlas') or {}).get('size') or 1024)
    base_atlas, base_place, base_size = bake_baseline(jarpaths, atlas_min, verbose)

    # -- 覆盖集合：材质包真正提供的纹理（按 key 去重后的纹理相对路径）--
    overrides = set()
    for key in pack.textures:
        overrides.add(texture_key_to_name(key))

    # -- lang：内置 lang.json 为底，材质包覆盖/合并 --
    base_lang = _json_load(os.path.join(base_dir, 'lang.json'), None)
    if not isinstance(base_lang, dict):
        raise PackError('基准资产缺少可用的 lang.json：%s' % os.path.join(base_dir, 'lang.json'))
    en_block, zh_block, lang_covered = merge_lang(base_lang, pack)

    # -- 正式烘焙（分层源 + 冻结图集 + 合并 lang）--
    frozen = FrozenLayoutAtlas(base_atlas, base_place, base_size, padding=2,
                               overrides=overrides, verbose=verbose)
    if verbose:
        print('[pack] 分层烘焙（pack 覆盖 -> 内置 jar 兜底）...')
    res = bake.build(jarpaths, out_dir, atlas_min=atlas_min,
                     lang_pair=(en_block, zh_block), src=src,
                     atlas_fn=frozen, verbose=verbose, write_atlas_index=False)

    meta = res['meta']
    # 图集统计以实际图集布局为准（可能包含材质包新增纹理、也可能有被放弃引用的旧纹理）
    tex_count = len([k for k in frozen.base_place if k != bake.MISSING_TEX]) \
        + len(frozen.appended)
    meta['textureCount'] = tex_count
    meta['atlasUsage'] = round(frozen.usage, 4)
    if isinstance(meta.get('atlas'), dict):
        meta['atlas']['usedPixels'] = int(round(frozen.usage * frozen.size * frozen.size))
        meta['atlas']['size'] = frozen.size
    bake.write_json(os.path.join(out_dir, 'meta.json'), meta)

    # -- 实体模型后处理（可选，失败回滚不影响材质包）--
    if frozen.grown:
        notes.append('图集空闲区不足，已放大到 %d×%d（最近邻）' % (frozen.size, frozen.size))
    if frozen.resized:
        notes.append('材质包内 %d 张纹理尺寸与内置不一致，已按原 UV 区缩放（不改变布局）'
                     % len(frozen.resized))
    if frozen.appended:
        notes.append('材质包新增 %d 张纹理，已追加到图集空闲区' % len(frozen.appended))
    if not pack.blockstates and not pack.models and not pack.textures and not pack.lang:
        notes.append('材质包未提供任何 assets/minecraft/ 资源：输出与内置资产统计一致')
    post = run_post_entity_models(out_dir, notes, verbose)

    # -- 图集布局索引（QA 辅助，写进 report.json 供 verify_pack.py 严格校验 uv）--
    out_index = collections.OrderedDict(
        (k, list(v)) for k, v in frozen.base_place.items())
    for tex, cell in frozen.appended.items():
        out_index[tex] = list(cell)
    # 后处理脚本（post_entity_models.py）可能新增纹理（如箱子实体纹理），
    # 这些纹理不在冻结布局里：用它们的 quad uv 包围盒推导图集格并补入索引。
    derived = collections.OrderedDict()
    try:
        _models_doc = _json_load(os.path.join(out_dir, 'models.json'), {}) or {}
        _bbox = {}
        for _m in (_models_doc.get('models') or {}).values():
            for _q in _m.get('quads') or []:
                _tex = _q.get('tex')
                _uv = _q.get('uv') or []
                if not _tex or len(_uv) != 8 or _tex in out_index:
                    continue
                _xs, _ys = _uv[0::2], _uv[1::2]
                _b = _bbox.get(_tex)
                if _b is None:
                    _bbox[_tex] = [min(_xs), min(_ys), max(_xs), max(_ys)]
                else:
                    _b[0] = min(_b[0], min(_xs))
                    _b[1] = min(_b[1], min(_ys))
                    _b[2] = max(_b[2], max(_xs))
                    _b[3] = max(_b[3], max(_ys))
        for _tex, _bb in sorted(_bbox.items()):
            _cell = [int(round(_bb[0])), int(round(_bb[1])),
                     int(round(_bb[2] - _bb[0])), int(round(_bb[3] - _bb[1]))]
            out_index[_tex] = _cell
            derived[_tex] = _cell
    except Exception as exc:
        notes.append('图集布局索引补全失败（不影响产物）：%s' % exc)
    if derived:
        notes.append('后处理新增 %d 张纹理，其图集格由 quad uv 包围盒推导并写入 report.atlasIndex'
                     % len(derived))

    # -- 产物 manifest / 模型分片自检（viewer 按 modelsCount 逐个拉分片，缺一个就整体回退）--
    man_info = ensure_manifest_and_shards(out_dir, base_dir, notes, warnings, verbose)

    # -- report.json --
    manifest = _json_load(os.path.join(out_dir, 'manifest.json'), {}) or {}
    stats = collect_stats(out_dir, manifest)
    # overrides：受影响条目总数（数字，src/ui/packs.js 直接展示）；明细放 overridesDetail
    overrides_detail = collections.OrderedDict([
        ('blockstates', len(pack.blockstates)),
        ('models', len(pack.models)),
        ('textures', len(pack.textures)),
        ('lang', len(pack.lang)),
    ])
    overrides_total = sum(overrides_detail.values())
    skipped_unique = collections.OrderedDict()
    for key, why in pack.skipped:
        skipped_unique.setdefault(key, why)
    if skipped_unique:
        warnings.append('材质包内有 %d 个文件无法使用，已跳过：%s'
                        % (len(skipped_unique),
                           '；'.join('%s（%s）' % (k, w)
                                    for k, w in list(skipped_unique.items())[:3])))
    report = collections.OrderedDict([
        ('ok', True),
        ('overrides', overrides_total),
        ('overridesDetail', overrides_detail),
        ('stats', stats),
        ('elapsedMs', int(round((time.time() - t_start) * 1000))),
        ('warnings', warnings),
        ('notes', notes),
        ('skippedEntries', [collections.OrderedDict([('path', k), ('reason', why)])
                            for k, why in skipped_unique.items()]),
        ('pack', collections.OrderedDict([
            ('file', os.path.basename(pack_path)),
            ('size', os.path.getsize(pack_path)),
            ('entries', pack.raw_entries),
            ('ignoredEntries', pack.ignored),
            ('blockstates', pack.blockstates),
            ('models', pack.models),
            ('textures', pack.textures),
            ('langFiles', pack.lang),
            ('langKeys', sorted(lang_covered)),
            ('legacyAliasedTextures', list(pack.aliased)),
            ('mcmeta', compat),
        ])),
        ('atlas', collections.OrderedDict([
            ('size', frozen.size), ('padding', 2),
            ('baselineSize', base_size), ('grown', frozen.grown),
            ('usage', round(frozen.usage, 4)),
            ('pastedTextures', len(frozen.pasted)),
            ('appendedTextures', len(frozen.appended)),
        ])),
        ('atlasIndex', collections.OrderedDict([
            ('size', frozen.size), ('padding', 2),
            ('index', out_index),
        ])),
        ('postEntityModels', post),
        ('manifest', man_info),
        ('files', collections.OrderedDict(
            (name, _file_info(os.path.join(out_dir, name)))
            for name in ('manifest.json', 'blocks.json', 'models.json',
                         'lang.json', 'meta.json', 'atlas.png'))),
    ])
    # 新追加纹理也写进 atlasIndex，供 verify_pack.py 校验 uv 区域
    for tex, cell in frozen.appended.items():
        report['atlasIndex']['index'][tex] = list(cell)
    write_report(out_dir, report)

    if verbose:
        print('[pack] 完成：blocks=%d models=%d quads=%d textures=%d 覆盖=%d（%s） %.2fs'
              % (stats['blocks'], stats['models'], stats['quads'], stats['textures'],
                 overrides_total, dict(overrides_detail), report['elapsedMs'] / 1000.0))
    for w in warnings:
        print('  [warn] %s' % w)
    for note in notes:
        print('  [note] %s' % note)
    return report


def _error_report(out_dir, base_dir, err, t_start):
    """失败时也尽量写 report.json（除非 --out 指向禁止写入的位置）。"""
    allowed, _ = check_out_dir(out_dir, base_dir)
    if not allowed:
        return
    try:
        os.makedirs(_abs(out_dir), exist_ok=True)
        write_report(out_dir, collections.OrderedDict([
            ('ok', False),
            ('error', err),
            ('overrides', 0),
            ('overridesDetail', collections.OrderedDict([
                ('blockstates', 0), ('models', 0), ('textures', 0), ('lang', 0)])),
            ('stats', {}),
            ('elapsedMs', int(round((time.time() - t_start) * 1000))),
            ('warnings', []),
            ('notes', []),
        ]))
    except Exception:
        pass


def main(argv=None):
    ap = argparse.ArgumentParser(
        description='mcviewer 材质包烘焙：资源包 zip -> 与内置 assets 同构的一整套资产')
    ap.add_argument('--pack', required=True, help='用户资源包 zip 路径')
    ap.add_argument('--out', required=True,
                    help='输出目录（将写入 manifest/blocks/models/lang/meta/atlas + report.json）')
    ap.add_argument('--base', default=DEFAULT_BASE,
                    help='内置基准资产目录（默认 assets；只读，不会被改写）')
    ap.add_argument('--jars', default=DEFAULT_JARS,
                    help='客户端 jar，逗号分隔，前面的优先（默认 %s）' % DEFAULT_JARS)
    ap.add_argument('--verbose', action='store_true', help='打印详细过程')
    args = ap.parse_args(argv)
    t_start = time.time()
    out_dir = _abs(args.out)
    base_dir = _abs(args.base)
    try:
        report = run(args)
        return 0
    except PackError as exc:
        err = str(exc)
    except SystemExit:
        raise
    except Exception as exc:      # noqa: BLE001
        err = '烘焙失败：%s: %s' % (type(exc).__name__, exc)
    print('[pack] 失败：%s' % err, file=sys.stderr)
    _error_report(out_dir, base_dir, err, t_start)
    return 2


if __name__ == '__main__':
    sys.exit(main())
