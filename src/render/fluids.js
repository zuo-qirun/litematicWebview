/**
 * 流体（水 / 岩浆 / 含水方块）的渲染参数。
 *
 * 为什么需要它：`.litematic` 里 `minecraft:water[level=N]` 一共 16 种状态，但烘焙后的
 * `blocks.json` 对 water 只有一个模型（整方块占位），因为原版水的高度是**运行时按
 * level 算出来的**（Java 里由 FluidState.getHeight 决定），不在模型数据里：
 *
 *   h = (8 - level) / 9     level 0..7   → 0.888 … 0.111
 *   h = 1                    level ≥ 8    → 下落的水柱，整格
 *
 * 岩浆同理（原版也是 8/9 高）。含水方块（waterlogged=true）在方块自身几何之外还
 * 有一层 8/9 高的水；气泡柱（bubble_column）是整格水。
 */

const AIR_IDS = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);

/** 解析 "minecraft:water[level=3]" → { id, props } */
export function parseState(stateKey) {
  const i = stateKey.indexOf("[");
  if (i < 0) return { id: stateKey, props: null };
  const props = {};
  const body = stateKey.slice(i + 1, stateKey.lastIndexOf("]"));
  for (const pair of body.split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) props[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return { id: stateKey.slice(0, i), props };
}

function heightForLevel(level) {
  if (!Number.isFinite(level)) return 8 / 9;
  if (level >= 8) return 1; // 下落的水柱 / 岩浆柱
  const l = Math.max(0, level);
  return (8 - l) / 9;
}

/**
 * 纯流体方块（water / lava / bubble_column）的流体信息。
 * @returns {{kind:'water'|'lava', height:number}|null}
 */
export function fluidInfo(stateKey) {
  const { id, props } = parseState(stateKey);
  if (AIR_IDS.has(id)) return null;
  if (id === "minecraft:water") {
    const lv = props && props.level != null ? Number(props.level) : 0;
    return { kind: "water", height: heightForLevel(lv) };
  }
  if (id === "minecraft:lava") {
    const lv = props && props.level != null ? Number(props.level) : 0;
    return { kind: "lava", height: heightForLevel(lv) };
  }
  if (id === "minecraft:bubble_column") {
    // 气泡柱在游戏里就是整格水（含 soul_sand / magma 两种），这里统一画成整格水
    return { kind: "water", height: 1 };
  }
  return null;
}

/** 含水方块：waterlogged=true 的方块本体之外还要画一层水 */
export function waterloggedInfo(stateKey) {
  const { props } = parseState(stateKey);
  if (!props || props.waterlogged !== "true") return null;
  return { kind: "water", height: 8 / 9 };
}

/** 这个状态是不是「纯流体」——纯流体不画方块模型，只画流体层 */
export function isPureFluid(stateKey) {
  return fluidInfo(stateKey) !== null;
}

/** 流体层在方块内的水平内缩，避免与方块自身的面共面 z-fighting */
export const FLUID_INSET = 0.004;
