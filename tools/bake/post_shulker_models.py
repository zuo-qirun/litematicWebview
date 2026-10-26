#!/usr/bin/env python3
"""合成潜影盒（shulker_box）方块几何 / 贴图，写回 assets。

原版潜影盒是方块实体：jar 里 `models/block/shulker_box.json` 只有 particle 贴图、
没有 elements，所以烘焙出来的模型是 6 quad 的 `__missing__` 占位（渲染成洋红）。

原版渲染（`ShulkerBoxRenderer`）复用潜影贝的 `ShulkerModel`，但盒体只用
`textures/entity/shulker/shulker[_<颜色>].png` 里 (0,0)-(64,32) 那块完整的
16x16x16 盒 UV 网（脸/眼睛区域不属于盒体）。闭合状态下 lid+base 叠成一个
16 高的整方块，因此这里直接用 16³ 盒子 + texOffs(0,0) 的 box-UV 展开近似。

用法：
    python tools/bake/post_shulker_models.py
    python tools/bake/post_shulker_models.py --assets assets \\
        --jars _dl/client-1.21.1.jar,_dl/client-26.3.jar --tex-dir _dl/shulkertex

前置：先跑 `bake.py`（或 `post_entity_models.py`），assets/ 里已有
models/blocks/meta/manifest/atlas。
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import post_entity_models as P  # noqa: E402  （复用几何 / 图集工具）

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "assets"
DEFAULT_JARS = ["_dl/client-1.21.1.jar", "_dl/client-26.3.jar"]

# (方块名, 纹理基名)；顺序即图集分配顺序
COLORS = [
    ("shulker_box", "shulker"),
    ("white_shulker_box", "shulker_white"),
    ("orange_shulker_box", "shulker_orange"),
    ("magenta_shulker_box", "shulker_magenta"),
    ("light_blue_shulker_box", "shulker_light_blue"),
    ("yellow_shulker_box", "shulker_yellow"),
    ("lime_shulker_box", "shulker_lime"),
    ("pink_shulker_box", "shulker_pink"),
    ("gray_shulker_box", "shulker_gray"),
    ("light_gray_shulker_box", "shulker_light_gray"),
    ("cyan_shulker_box", "shulker_cyan"),
    ("purple_shulker_box", "shulker_purple"),
    ("blue_shulker_box", "shulker_blue"),
    ("brown_shulker_box", "shulker_brown"),
    ("green_shulker_box", "shulker_green"),
    ("red_shulker_box", "shulker_red"),
    ("black_shulker_box", "shulker_black"),
]

SOURCE_BOX = (0, 0, 64, 52)  # 潜影贝纹理里「盒体」用到的区域：lid(0,0) 16³ + base(0,28) 16x8x16
TILE_W = SOURCE_BOX[2] - SOURCE_BOX[0]  # 64
TILE_H = SOURCE_BOX[3] - SOURCE_BOX[1]  # 52
HALO = 1  # 贴图外侧透明边，防最近邻渗色
FACINGS = (("north", 0), ("east", 90), ("south", 180), ("west", 270))
MARKER_KEY = "shulkerModels"
# 与潜影贝 ShulkerModel 一致：lid 16³ 占满整格，base 16x8x16 贴在格子下半部
LID_BOX = (0, 0, 0, 16, 16, 16)
LID_TEX_OFF = (0, 0)
LID_DIMS = (16, 16, 16)
BASE_BOX = (0, 0, 0, 16, 8, 16)
BASE_TEX_OFF = (0, 28)
BASE_DIMS = (16, 8, 16)


def tex_path(texname: str) -> str:
    return f"textures/entity/shulker/{texname}.png"


_ORIG_TEX_LAYOUT = P.tex_layout


def _world_tex_layout(u0, v0, w, h, d):
    """原版渲染潜影盒用 scale(1,-1,-1)（模型里 y/z 反向），所以世界空间的顶面
    取的是模型 down 的 UV、底面取 up、南北互换。这里直接把 UV 布局映射到
    世界空间的六面，几何仍按普通盒 UV 生成。"""
    lay = _ORIG_TEX_LAYOUT(u0, v0, w, h, d)
    return {
        0: lay[1],  # world down  ← model up（嘴部内侧，闭合时贴地看不见）
        1: lay[0],  # world up    ← model down（外壳顶面，不透明）
        2: lay[3],  # world north ← model south
        3: lay[2],  # world south ← model north
        4: lay[4],  # world west
        5: lay[5],  # world east
    }


def model_id_for(block: str, y: int) -> str:
    base = f"block/{block}"
    return base if y % 360 == 0 else f"{base}#0,{y}"


def build_tile(img: Image.Image) -> np.ndarray:
    crop = img.convert("RGBA").crop(SOURCE_BOX)
    return np.pad(np.asarray(crop, dtype=np.uint8), ((HALO, HALO), (HALO, HALO), (0, 0)), mode="edge")


def load_shulker_textures(jars: list[str], tex_dir: Path) -> dict[str, Image.Image]:
    zips = []
    for j in jars:
        if Path(j).exists():
            zips.append((Path(j).name, zipfile.ZipFile(j)))
    out: dict[str, Image.Image] = {}
    missing: list[str] = []
    try:
        for block, texname in COLORS:
            name = "assets/minecraft/" + tex_path(texname)
            img = None
            for _base, z in zips:
                try:
                    with z.open(name) as fh:
                        img = Image.open(fh)
                        img.load()
                        break
                except KeyError:
                    continue
            if img is None:
                local = tex_dir / f"{texname}.png"
                if local.exists():
                    img = Image.open(local)
            if img is None:
                missing.append(texname)
                continue
            if img.size != (64, 64):
                img = img.convert("RGBA").resize((64, 64), Image.NEAREST)
            out[block] = img
    finally:
        for _base, z in zips:
            z.close()
    if missing:
        raise SystemExit(f"缺少潜影盒纹理：{', '.join(missing)}（jar 与 --tex-dir 都没有）")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="合成潜影盒几何并写回 assets")
    ap.add_argument("--jars", default=",".join(DEFAULT_JARS), help="客户端 jar 列表（逗号分隔）")
    ap.add_argument("--tex-dir", default=str(ROOT / "_dl" / "shulkertex"), help="贴图目录（jar 读不到时回退）")
    ap.add_argument("--assets", default=str(ASSETS), help="assets 目录")
    args = ap.parse_args()

    assets = Path(args.assets)
    models_path = assets / "models.json"
    blocks_path = assets / "blocks.json"
    meta_path = assets / "meta.json"
    manifest_path = assets / "manifest.json"
    atlas_path = assets / "atlas.png"

    models_doc = P.load_json(models_path)
    models = models_doc["models"]
    blocks_doc = P.load_json(blocks_path)
    blocks = blocks_doc["blocks"]
    meta = P.load_json(meta_path) if meta_path.exists() else {}
    manifest = P.load_json(manifest_path)
    atlas = Image.open(atlas_path).convert("RGBA")
    size = atlas.width
    if atlas.height != size:
        print(f"atlas 不是正方形：{atlas.width}x{atlas.height}")
        return 2

    P.self_test(models)

    # 1. 读纹理
    jars = [str(ROOT / j) for j in args.jars.split(",") if j.strip()]
    textures = load_shulker_textures(jars, Path(args.tex_dir))
    print(f"纹理：{len(textures)} 张（来自 {', '.join(Path(j).name for j in jars if Path(j).exists())}）")

    # 2. 图集分配
    our_ids: set[str] = set()
    for block, _texname in COLORS:
        for _f, y in FACINGS:
            our_ids.add(model_id_for(block, y))
        our_ids.add(model_id_for(block, 0))

    prev = (meta.get(MARKER_KEY) or {}).get("rects") or {}
    occ = P.occupancy(models, set(our_ids), size, dilate=1)
    rects: dict[str, list[int]] = {}
    for block, _texname in COLORS:
        cached = prev.get(block)
        x = y = None
        if isinstance(cached, list) and len(cached) == 4:
            cx, cy = int(cached[0]) - HALO, int(cached[1]) - HALO
            w, h = (TILE_W + 2 * HALO), (TILE_H + 2 * HALO)
            if cx >= 0 and cy >= 0 and cx + w <= size and cy + h <= size and not occ[cy:cy + h, cx:cx + w].any():
                x, y = cx, cy
        if x is None:
            x, y = P.find_free(occ, TILE_W + 2 * HALO, TILE_H + 2 * HALO)
        rects[block] = [x + HALO, y + HALO, x + HALO + TILE_W, y + HALO + TILE_H]
        occ[y:y + TILE_H + 2 * HALO, x:x + TILE_W + 2 * HALO] = True

    arr = np.array(atlas)
    for block, _texname in COLORS:
        x0, y0, _x1, _y1 = rects[block]
        tile = build_tile(textures[block])
        arr[y0 - HALO:y0 - HALO + tile.shape[0], x0 - HALO:x0 - HALO + tile.shape[1], :] = tile

    out_img = Image.fromarray(arr, "RGBA")
    out_img.save(atlas_path)
    try:
        out_img.save(assets / "atlas.webp", format="WEBP", lossless=True, quality=100, method=6)
        webp_ok = True
    except Exception as exc:  # noqa: BLE001
        webp_ok = False
        print(f"  warn: atlas.webp 生成失败：{exc}")

    # 3. 模型（世界空间 UV：原版渲染用 scale(1,-1,-1)，需把模型六面重映射）
    made = 0
    orig_layout = P.tex_layout
    P.tex_layout = _world_tex_layout
    try:
        for block, texname in COLORS:
            uv_off = (rects[block][0], rects[block][1])
            tex = f"entity/shulker/{texname}"
            base_quads = P._snap(
                P._box_quads(LID_BOX, LID_TEX_OFF, LID_DIMS, tex, uv_off)
                + P._box_quads(BASE_BOX, BASE_TEX_OFF, BASE_DIMS, tex, uv_off)
            )
            for _f, y in FACINGS:
                mid = model_id_for(block, y)
                quads = P.rotate_quads(base_quads, y) if y % 360 else base_quads
                P.check_quads(quads, size, where=mid)
                models[mid] = {"quads": quads}
                made += 1
    finally:
        P.tex_layout = orig_layout

    # 4. blocks.json（facing 变体 + 无 when 兜底，兜底放最后）
    for block, _texname in COLORS:
        variants = [{"when": {"facing": f}, "models": [model_id_for(block, y)]} for f, y in FACINGS]
        variants.append({"models": [model_id_for(block, 0)]})
        blocks[f"minecraft:{block}"] = {"kind": "variants", "variants": variants, "render": "cutout"}

    # 5. meta
    fb = meta.get("fallbackModels")
    if isinstance(fb, list):
        implemented = {f"block/{b}" for b, _t in COLORS}
        meta["fallbackModels"] = [m for m in fb if m not in implemented]
    quad_total = sum(len(m.get("quads") or []) for m in models.values())
    occ_all = P.occupancy(models, set(), size, dilate=0)
    meta["modelCount"] = len(models)
    meta["quadCount"] = quad_total
    if "atlasUsage" not in meta:
        meta["atlasUsage"] = round(float(occ_all.mean()), 4)
    notes = [n for n in (meta.get("notes") or []) if "shulker" not in str(n).lower()]
    notes.append(
        "潜影盒用潜影贝实体纹理 entity/shulker/shulker[_颜色].png 的 (0,0)-(64,32) 盒 UV 网"
        "合成 16³ 盒几何（原版是方块实体由 Java 渲染，jar 内无 elements），17 个方块 × 4 朝向 = 68 个模型"
    )
    meta["notes"] = notes
    meta[MARKER_KEY] = {
        "rects": rects,
        "tile": [TILE_W, TILE_H],
        "blocks": [b for b, _t in COLORS],
        "models": made,
    }

    P.write_json(models_path, models_doc)
    P.write_json(blocks_path, blocks_doc)
    P.write_json(meta_path, meta)

    # 6. 单模型分片 + manifest
    shard_dir = assets / manifest.get("modelsDir", "models")
    if manifest.get("modelsMode") == "files" and shard_dir.is_dir():
        for mid in our_ids:
            if mid in models:
                (shard_dir / f"{P.model_file_name(mid)}.json").write_text(
                    json.dumps(models[mid]["quads"], ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                    newline="\n",
                )
        manifest["modelsCount"] = len(models)
        P.write_json(manifest_path, manifest)

    # 7. 自检
    back = np.array(Image.open(atlas_path).convert("RGBA"))
    ok = True
    for block, _texname in COLORS:
        x0, y0, x1, y1 = rects[block]
        want = build_tile(textures[block])[HALO:HALO + (y1 - y0), HALO:HALO + (x1 - x0)]
        got = back[y0:y1, x0:x1]
        if want.shape != got.shape or not np.array_equal(want, got):
            ok = False
            print(f"  自检失败：block/{block} 图集像素不一致")
    for mid in our_ids:
        if mid not in models:
            ok = False
            print(f"  自检失败：模型缺失 {mid}")
    for block, _t in COLORS:
        ref = blocks.get(f"minecraft:{block}") or {}
        for v in ref.get("variants") or ():
            for m in v.get("models") or ():
                if m not in models:
                    ok = False
                    print(f"  自检失败：blocks 引用了不存在的模型 {m}")

    print(f"潜影盒：{len(COLORS)} 个方块 / {made} 个模型")
    print(f"  图集 {size}x{size}：占用 {meta['atlasUsage'] * 100:.1f}%  webp={'ok' if webp_ok else 'skip'}")
    print(f"  models.json {models_path.stat().st_size} B / {len(models)} 模型 / {quad_total} quad")
    print(f"  blocks.json {blocks_path.stat().st_size} B / meta.json {meta_path.stat().st_size} B")
    print(f"  自检 {'OK' if ok else '失败'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
