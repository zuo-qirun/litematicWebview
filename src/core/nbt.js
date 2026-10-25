/**
 * nbt.js — 零依赖 NBT（Named Binary Tag）读取器。
 *
 * 纯 ESM，浏览器 / Node 双端可用；只依赖 DataView / TextDecoder / TypedArray。
 * 大端字节序；覆盖 TAG_End(0) ~ TAG_Long_Array(12) 全部类型。
 *
 * 返回值约定（"干净" JS 对象，供 UI / 渲染层直接使用）：
 *   TAG_Compound   -> 普通对象（同名 key 后者覆盖前者）
 *   TAG_List       -> 数组
 *   TAG_String     -> string
 *   TAG_Byte/Short/Int/Long/Float/Double -> number
 *   TAG_Byte_Array -> Uint8Array（无拷贝视图）
 *   TAG_Int_Array  -> Int32Array
 *   TAG_Long_Array -> BigInt64Array（默认，语义为有符号 TAG_Long）
 *                     或 RawLongArray（options.longArrayAs = "raw"，无拷贝视图，
 *                     供解析 BlockStates 时零拷贝快速位解包）
 *
 * 说明：TAG_Long 标量超过 Number.MAX_SAFE_INTEGER 时会丢精度；litematic 里只有
 * 时间戳/种子这类字段用 long，均在上限以内。
 */

export const TAG = Object.freeze({
  END: 0,
  BYTE: 1,
  SHORT: 2,
  INT: 3,
  LONG: 4,
  FLOAT: 5,
  DOUBLE: 6,
  BYTE_ARRAY: 7,
  STRING: 8,
  LIST: 9,
  COMPOUND: 10,
  INT_ARRAY: 11,
  LONG_ARRAY: 12,
});

const TAG_NAMES = Object.freeze({
  0: 'TAG_End',
  1: 'TAG_Byte',
  2: 'TAG_Short',
  3: 'TAG_Int',
  4: 'TAG_Long',
  5: 'TAG_Float',
  6: 'TAG_Double',
  7: 'TAG_Byte_Array',
  8: 'TAG_String',
  9: 'TAG_List',
  10: 'TAG_Compound',
  11: 'TAG_Int_Array',
  12: 'TAG_Long_Array',
});

export function tagName(type) {
  return TAG_NAMES[type] || `TAG_?( ${type} )`;
}

/** 危险的普通对象键名（防止恶意 NBT 通过 __proto__ 污染原型链）。 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * TAG_Long_Array 的零拷贝视图（大端序 64 位整数序列）。
 * 解析 BlockStates 时不需要把它展开成 BigInt，直接用 lo/hi 两个 32 位半部做位解包。
 */
export class RawLongArray {
  /**
   * @param {DataView} dataView 底层数据
   * @param {number} byteOffset 第一个 long 的字节偏移（相对 dataView 起点）
   * @param {number} length long 个数
   */
  constructor(dataView, byteOffset, length) {
    this.dataView = dataView;
    this.byteOffset = byteOffset;
    this.length = length;
  }

  /** 第 i 个 long 的无符号 32 位低半部。 */
  getLo(i) {
    return this.dataView.getUint32(this.byteOffset + (i << 3) + 4);
  }

  /** 第 i 个 long 的无符号 32 位高半部。 */
  getHi(i) {
    return this.dataView.getUint32(this.byteOffset + (i << 3));
  }

  /** 展开成有符号 BigInt64Array（TAG_Long 语义），用于输出给 UI。 */
  toBigInt64Array() {
    const n = this.length;
    const out = new BigInt64Array(n);
    const dv = this.dataView;
    const base = this.byteOffset;
    for (let i = 0; i < n; i++) {
      out[i] = dv.getBigInt64(base + (i << 3));
    }
    return out;
  }
}

/** 把 ArrayBuffer / 任意 TypedArray / DataView 统一成 DataView。 */
function toDataView(input) {
  if (input instanceof DataView) return input;
  if (input instanceof ArrayBuffer) return new DataView(input);
  if (ArrayBuffer.isView(input)) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  if (typeof SharedArrayBuffer !== 'undefined' && input instanceof SharedArrayBuffer) {
    return new DataView(input);
  }
  throw new TypeError('readNbt: 需要 ArrayBuffer / TypedArray / DataView 输入');
}

class NbtReader {
  constructor(dataView, options) {
    this.dv = dataView;
    this.pos = 0;
    this.length = dataView.byteLength;
    this.options = options;
    this.textDecoder = new TextDecoder('utf-8');
    this.depth = 0;
    this.maxDepth = options.maxDepth;
  }

  fail(message) {
    throw new Error(`NBT 解析失败(@${this.pos}): ${message}`);
  }

  ensure(n) {
    if (this.pos + n > this.length) {
      this.fail(`数据截断，需要 ${n} 字节，仅剩 ${this.length - this.pos}`);
    }
  }

  u8() {
    this.ensure(1);
    return this.dv.getUint8(this.pos++);
  }

  i8() {
    this.ensure(1);
    return this.dv.getInt8(this.pos++);
  }

  i16() {
    this.ensure(2);
    const v = this.dv.getInt16(this.pos);
    this.pos += 2;
    return v;
  }

  i32() {
    this.ensure(4);
    const v = this.dv.getInt32(this.pos);
    this.pos += 4;
    return v;
  }

  /** TAG_Long 标量 -> number（有符号 64 位，超出 2^53 会丢精度）。 */
  i64AsNumber() {
    this.ensure(8);
    const hi = this.dv.getInt32(this.pos);
    const lo = this.dv.getUint32(this.pos + 4);
    this.pos += 8;
    return hi * 4294967296 + lo;
  }

  f32() {
    this.ensure(4);
    const v = this.dv.getFloat32(this.pos);
    this.pos += 4;
    return v;
  }

  f64() {
    this.ensure(8);
    const v = this.dv.getFloat64(this.pos);
    this.pos += 8;
    return v;
  }

  /** 读取 UTF-8 字符串（无符号 16 位长度前缀）。 */
  string() {
    this.ensure(2);
    const len = this.dv.getUint16(this.pos);
    this.pos += 2;
    if (len === 0) return '';
    this.ensure(len);
    const bytes = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.pos, len);
    this.pos += len;
    return this.textDecoder.decode(bytes);
  }

  byteArray() {
    const n = this.i32();
    if (n < 0) this.fail(`TAG_Byte_Array 长度为负: ${n}`);
    this.ensure(n);
    const out = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.pos, n);
    this.pos += n;
    return out;
  }

  intArray() {
    const n = this.i32();
    if (n < 0) this.fail(`TAG_Int_Array 长度为负: ${n}`);
    this.ensure(n * 4);
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = this.dv.getInt32(this.pos + (i << 2));
    }
    this.pos += n * 4;
    return out;
  }

  longArray() {
    const n = this.i32();
    if (n < 0) this.fail(`TAG_Long_Array 长度为负: ${n}`);
    this.ensure(n * 8);
    if (this.options.longArrayAs === 'raw') {
      const view = new RawLongArray(this.dv, this.pos, n);
      this.pos += n * 8;
      return view;
    }
    const out = new BigInt64Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = this.dv.getBigInt64(this.pos + (i << 3));
    }
    this.pos += n * 8;
    return out;
  }

  /** 按 tag 类型读取 payload（不含类型字节与名字）。 */
  payload(type) {
    switch (type) {
      case TAG.BYTE:
        return this.i8();
      case TAG.SHORT:
        return this.i16();
      case TAG.INT:
        return this.i32();
      case TAG.LONG:
        return this.i64AsNumber();
      case TAG.FLOAT:
        return this.f32();
      case TAG.DOUBLE:
        return this.f64();
      case TAG.BYTE_ARRAY:
        return this.byteArray();
      case TAG.STRING:
        return this.string();
      case TAG.LIST:
        return this.list();
      case TAG.COMPOUND:
        return this.compound();
      case TAG.INT_ARRAY:
        return this.intArray();
      case TAG.LONG_ARRAY:
        return this.longArray();
      case TAG.END:
        this.fail('TAG_End 不能作为 payload');
        return null;
      default:
        this.fail(`未知 tag 类型 ${type}`);
        return null;
    }
  }

  list() {
    const elemType = this.u8();
    const n = this.i32();
    if (n < 0) this.fail(`TAG_List 长度为负: ${n}`);
    // 类型 0 的空列表是合法的；类型 0 非空则是损坏数据。
    if (elemType === TAG.END) {
      if (n > 0) this.fail(`TAG_List 元素类型为 TAG_End 但长度 ${n} > 0`);
      return [];
    }
    const out = new Array(n);
    if (elemType === TAG.COMPOUND || elemType === TAG.LIST) {
      if (++this.depth > this.maxDepth) this.fail(`嵌套过深（> ${this.maxDepth}）`);
      for (let i = 0; i < n; i++) out[i] = this.payload(elemType);
      this.depth--;
    } else {
      // 基础类型：直接按 payload 顺序读取，避免每个元素走 switch 太多开销
      switch (elemType) {
        case TAG.BYTE:
        case TAG.SHORT:
        case TAG.INT:
        case TAG.LONG:
        case TAG.FLOAT:
        case TAG.DOUBLE: {
          const size = elemType === TAG.BYTE ? 1 : elemType === TAG.SHORT ? 2 : elemType === TAG.INT ? 4 : elemType === TAG.LONG ? 8 : elemType === TAG.FLOAT ? 4 : 8;
          this.ensure(n * size);
          const dv = this.dv;
          let p = this.pos;
          if (elemType === TAG.BYTE) {
            for (let i = 0; i < n; i++) out[i] = dv.getInt8(p++);
          } else if (elemType === TAG.SHORT) {
            for (let i = 0; i < n; i++) { out[i] = dv.getInt16(p); p += 2; }
          } else if (elemType === TAG.INT) {
            for (let i = 0; i < n; i++) { out[i] = dv.getInt32(p); p += 4; }
          } else if (elemType === TAG.FLOAT) {
            for (let i = 0; i < n; i++) { out[i] = dv.getFloat32(p); p += 4; }
          } else if (elemType === TAG.DOUBLE) {
            for (let i = 0; i < n; i++) { out[i] = dv.getFloat64(p); p += 8; }
          } else {
            for (let i = 0; i < n; i++) {
              const hi = dv.getInt32(p);
              const lo = dv.getUint32(p + 4);
              out[i] = hi * 4294967296 + lo;
              p += 8;
            }
          }
          this.pos = p;
          break;
        }
        case TAG.STRING: {
          for (let i = 0; i < n; i++) out[i] = this.string();
          break;
        }
        case TAG.BYTE_ARRAY: {
          for (let i = 0; i < n; i++) out[i] = this.byteArray();
          break;
        }
        case TAG.INT_ARRAY: {
          for (let i = 0; i < n; i++) out[i] = this.intArray();
          break;
        }
        case TAG.LONG_ARRAY: {
          for (let i = 0; i < n; i++) out[i] = this.longArray();
          break;
        }
        default:
          this.fail(`TAG_List 中出现未知元素类型 ${elemType}`);
      }
    }
    return out;
  }

  compound() {
    if (++this.depth > this.maxDepth) this.fail(`嵌套过深（> ${this.maxDepth}）`);
    const out = {};
    for (;;) {
      const type = this.u8();
      if (type === TAG.END) break;
      const name = this.string();
      const value = this.payload(type);
      if (UNSAFE_KEYS.has(name)) {
        Object.defineProperty(out, name, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } else {
        out[name] = value;
      }
    }
    this.depth--;
    return out;
  }
}

/**
 * 读取一个完整的 NBT 数据块。
 *
 * @param {ArrayBuffer|TypedArray|DataView} input 原始（未压缩）NBT 字节
 * @param {object} [options]
 * @param {"bigint"|"raw"} [options.longArrayAs="bigint"]
 *        "bigint" -> TAG_Long_Array 展开为 BigInt64Array（默认，"干净"输出）
 *        "raw"    -> TAG_Long_Array 返回零拷贝 RawLongArray 视图（解析 BlockStates 用）
 * @param {number} [options.maxDepth=512] 嵌套深度上限（防御恶意/损坏文件）
 * @returns {object|null} 根 compound 对象；空文件（TAG_End）返回 null
 */
export function readNbt(input, options = {}) {
  const longArrayAs = options.longArrayAs === 'raw' ? 'raw' : 'bigint';
  const maxDepth = typeof options.maxDepth === 'number' && options.maxDepth > 0 ? options.maxDepth : 512;
  const reader = new NbtReader(toDataView(input), { longArrayAs, maxDepth });
  const type = reader.u8();
  if (type === TAG.END) return null;
  reader.string(); // 根 tag 名字（合法 litematic 为空串）
  const value = reader.payload(type);
  if (type !== TAG.COMPOUND) {
    throw new Error(`NBT 根标签应为 TAG_Compound，实际是 ${tagName(type)}`);
  }
  return value;
}

/**
 * 读取根标签的 { name, value }（调试 / 兼容用途）。
 * @param {ArrayBuffer|TypedArray|DataView} input
 * @param {object} [options] 同 readNbt
 */
export function readNbtRoot(input, options = {}) {
  const longArrayAs = options.longArrayAs === 'raw' ? 'raw' : 'bigint';
  const maxDepth = typeof options.maxDepth === 'number' && options.maxDepth > 0 ? options.maxDepth : 512;
  const reader = new NbtReader(toDataView(input), { longArrayAs, maxDepth });
  const type = reader.u8();
  if (type === TAG.END) return null;
  const name = reader.string();
  return { name, type, value: reader.payload(type) };
}
