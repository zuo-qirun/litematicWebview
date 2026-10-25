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
            self.files.setdefault(key, info)
        # 分类（保持排序，保证可重复）
        def _list(prefix, suffix):
            return sorted(k for k in self.files if k.startswith(prefix) and k.endswith(suffix))

        self.blockstates = _list(OFFICIAL_DIRS['blockstates'], '.json')
        self.models = _list(OFFICIAL_DIRS['models'], '.json')
        self.textures = _list(OFFICIAL_DIRS['textures'], '.png')
        self.lang = _list(OFFICIAL_DIRS['lang'], '.json')
        self._validate_json_files()
        self._validate_textures()

    # -- 读取 --
    def read(self, path):
        key = _norm_key(path)
        info = self.files.get(key)
        return self.zip.read(info) if info is not None else None

    def _validate_json_files(self):
        for key in self.blockstates + self.models + self.lang:
            raw = self.read(key)
            try:
                obj = json.loads(raw.decode('utf-8-sig'))
            except Exception as exc:
                raise PackError('材质包内 JSON 无法解析：%s（%s）' % (key, exc))
            if not isinstance(obj, dict):
                raise PackError('材质包内 JSON 顶层必须是对象：%s' % key)

    def _validate_textures(self):
        for key in self.textures:
            raw = self.read(key)
            try:
                im = Image.open(io.BytesIO(raw))
                im.load()
            except Exception as exc:
                raise PackError('材质包内 PNG 无法解码：%s（%s）' % (key, exc))

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
                    raise PackError('材质包内 JSON 无法解析：%s（%s）' % (key, exc))
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
# 基线烘焙：拿到"内置 jars 下的基准图集布局"（不受材质包影响）
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

    # -- 基准图集布局（来自内置 jar，与材质包无关）--
    base_manifest = _json_load(os.path.join(base_dir, 'manifest.json'), {}) or {}
    atlas_min = int((base_manifest.get('atlas') or {}).get('size') or 1024)
    base_atlas, base_place, base_size = bake_baseline(jarpaths, atlas_min, verbose)

    # -- 覆盖集合：材质包真正提供的纹理（按 key 去重后的纹理相对路径）--
    overrides = set()
    for key in pack.textures:
        overrides.add(key[len(ASSET_HEAD + 'textures/'):-len('.png')])

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
    notes = []
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

    # -- report.json --
    manifest = _json_load(os.path.join(out_dir, 'manifest.json'), {}) or {}
    stats = collect_stats(out_dir, manifest)
    report = collections.OrderedDict([
        ('ok', True),
        ('overrides', collections.OrderedDict([
            ('blockstates', len(pack.blockstates)),
            ('models', len(pack.models)),
            ('textures', len(pack.textures)),
            ('lang', len(pack.lang)),
        ])),
        ('stats', stats),
        ('elapsedMs', int(round((time.time() - t_start) * 1000))),
        ('notes', notes),
        ('pack', collections.OrderedDict([
            ('file', os.path.basename(pack_path)),
            ('size', os.path.getsize(pack_path)),
            ('entries', pack.raw_entries),
            ('blockstates', pack.blockstates),
            ('models', pack.models),
            ('textures', pack.textures),
            ('langFiles', pack.lang),
            ('langKeys', sorted(lang_covered)),
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
        print('[pack] 完成：blocks=%d models=%d quads=%d textures=%d 覆盖=%s %.2fs'
              % (stats['blocks'], stats['models'], stats['quads'], stats['textures'],
                 dict(report['overrides']), report['elapsedMs'] / 1000.0))
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
            ('overrides', collections.OrderedDict([
                ('blockstates', 0), ('models', 0), ('textures', 0), ('lang', 0)])),
            ('stats', {}),
            ('elapsedMs', int(round((time.time() - t_start) * 1000))),
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
