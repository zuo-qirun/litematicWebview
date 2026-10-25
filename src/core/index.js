/**
 * index.js — 解析器入口：gzip 解压 + NBT 解析 + litematic 结构化。
 *
 * 纯 ESM，零依赖，浏览器 / Node 双端可用（Node 下用于 tests/parser/run.mjs）。
 * 唯一的可选环境依赖是 gzip 解压：
 *   浏览器 -> DecompressionStream("gzip")
 *   Node   -> DecompressionStream 可用时同样走它；否则动态 import("node:zlib") 兜底
 *             （用变量拼 specifier，保证 esbuild 不会把 node:zlib 静态打进浏览器包）
 */

import { readNbt } from './nbt.js';
import { parseLitematic } from './litematic.js';

export { TAG, RawLongArray, readNbt, readNbtRoot, tagName } from './nbt.js';
export {
  AIR,
  requiredBits,
  longCountFor,
  unpackStates,
  packStates,
  packStatesWords,
  parseLitematic,
} from './litematic.js';

/** gzip 魔数。 */
export const GZIP_MAGIC_0 = 0x1f;
export const GZIP_MAGIC_1 = 0x8b;

/** 把 ArrayBuffer / TypedArray 统一成 Uint8Array（不拷贝）。 */
function toBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('loadSchematic: 需要 ArrayBuffer / Uint8Array 输入');
}

/**
 * 判断字节流是否像 .litematic（gzip 魔数 1f 8b，或裸 NBT 根 TAG_Compound 0a 00）。
 * @param {ArrayBuffer|ArrayBufferView|Uint8Array} input
 * @returns {boolean}
 */
export function isLitematic(input) {
  let bytes;
  try {
    bytes = toBytes(input);
  } catch {
    return false;
  }
  if (bytes.length < 2) return false;
  const a = bytes[0];
  const b = bytes[1];
  return (a === GZIP_MAGIC_0 && b === GZIP_MAGIC_1) || (a === 0x0a && b === 0x00);
}

/** 动态拿 node:zlib（浏览器里返回 null；浏览器不会走到这里）。 */
async function tryImportZlib() {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return null;
  try {
    // 变量 specifier：避免打包器把它当成静态依赖解析
    const specifier = 'node:zlib';
    return await import(specifier);
  } catch {
    return null;
  }
}

/**
 * gzip 解压（双环境）。返回 ArrayBuffer。
 * @param {Uint8Array} bytes
 * @returns {Promise<ArrayBuffer>}
 */
export async function inflateGzip(bytes) {
  let primaryError = null;
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return await new Response(stream).arrayBuffer();
    } catch (e) {
      primaryError = e;
    }
  }
  const zlib = await tryImportZlib();
  if (zlib && typeof zlib.gunzipSync === 'function') {
    try {
      const out = zlib.gunzipSync(bytes);
      return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    } catch (e) {
      throw new Error(`gzip 解压失败: ${e && e.message ? e.message : e}`);
    }
  }
  throw new Error(
    `gzip 解压失败: 当前环境不支持 DecompressionStream${primaryError ? `（${primaryError.message || primaryError}）` : ''}`,
  );
}

/**
 * 从内存字节解析 .litematic（契约 §2）。
 *
 * 纯函数：同步输入内存字节、无 DOM 依赖；解析异常会 reject 带 message 的 Error，
 * 单个 region 的结构异常只进 schematic.warnings。
 *
 * @param {ArrayBuffer|ArrayBufferView|Uint8Array} arrayBuffer 文件原始字节（gzip 或裸 NBT）
 * @param {string} [fileName=""] 用于展示的文件名
 * @returns {Promise<object>} Schematic（契约 §2，含 regions / stats / warnings）
 */
export async function loadSchematic(arrayBuffer, fileName = '') {
  const name = typeof fileName === 'string' ? fileName : '';
  const bytes = toBytes(arrayBuffer);
  if (!isLitematic(bytes)) {
    throw new Error('不是有效的 .litematic 文件（缺少 gzip / NBT 魔数）');
  }
  const gzipped = bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
  let raw;
  if (gzipped) {
    try {
      raw = new Uint8Array(await inflateGzip(bytes));
    } catch (e) {
      throw new Error(`${name ? `${name}: ` : ''}${e && e.message ? e.message : 'gzip 解压失败'}`);
    }
  } else {
    raw = bytes;
  }

  let root;
  try {
    root = readNbt(raw, { longArrayAs: 'raw' });
  } catch (e) {
    throw new Error(`${name ? `${name}: ` : ''}NBT 解析失败: ${e && e.message ? e.message : e}`);
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error(`${name ? `${name}: ` : ''}NBT 根标签不是 TAG_Compound`);
  }
  return parseLitematic(root, { fileName: name });
}
