// 上传前的内容校验：gzip 有界解压 + NBT/litematic 真实解析。
// 目的：拒绝伪装文件、压缩炸弹、损坏文件，并顺手拿到方块数/作者等信息。
import { gunzipSync } from "node:zlib";
import { readNbtRoot } from "../core/nbt.js";
import { parseLitematic } from "../core/litematic.js";

export const GZIP_MAGIC = [0x1f, 0x8b];
export const MAX_INFLATED = 512 * 1024 * 1024; // 解压后上限 512MB（正常投影远小于此）

/** DataVersion → 人类可读 MC 版本（只列常见值，未知返回空串） */
const DATA_VERSION_MAP = new Map([
  [3700, "1.20.4"],
  [3837, "1.20.5"],
  [3953, "1.21"],
  [3955, "1.21.1"],
  [4082, "1.21.2"],
  [4189, "1.21.4"],
  [4325, "1.21.5"],
  [4671, "26.1"],
]);

export class InspectError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function hasGzipMagic(buf) {
  return Buffer.isBuffer(buf) && buf.length > 18 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1];
}

/**
 * 校验并摘要一个 .litematic 缓冲区。
 * @param {Buffer} buf
 * @returns {{blocks:number,regions:number,author:string,mcVersion:string,dataVersion:number,warnings:number}}
 */
export function inspectLitematic(buf) {
  if (!hasGzipMagic(buf)) throw new InspectError("INVALID_FILE", "不是 gzip 压缩的 .litematic 文件（魔数不符）");
  let raw;
  try {
    raw = gunzipSync(buf, { maxOutputLength: MAX_INFLATED });
  } catch (err) {
    if (err?.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|too large/i.test(String(err?.message))) {
      throw new InspectError("FILE_TOO_LARGE", "投影解压后体积过大，已拒绝", 413);
    }
    throw new InspectError("INVALID_FILE", "gzip 数据损坏或不是有效的 .litematic");
  }
  let root;
  try {
    root = readNbtRoot(raw);
  } catch {
    throw new InspectError("INVALID_FILE", "NBT 解析失败：不是有效的 Litematica 投影");
  }
  const compound = root?.value;
  if (!compound || typeof compound !== "object") throw new InspectError("INVALID_FILE", "NBT 根标签不是 compound");
  if (!compound.Regions || typeof compound.Regions !== "object") {
    throw new InspectError("INVALID_FILE", "缺少 Regions 标签，不是 Litematica 投影");
  }
  let schematic;
  try {
    schematic = parseLitematic(compound, {});
  } catch (err) {
    throw new InspectError("INVALID_FILE", `投影结构解析失败：${err?.message || "未知错误"}`);
  }
  const dataVersion = Number(schematic.dataVersion) || -1;
  return {
    blocks: Number(schematic.stats?.blockCount) || 0,
    regions: Number(schematic.stats?.regionCount) || (schematic.regions?.length ?? 0),
    author: String(schematic.metadata?.author || "").slice(0, 80),
    dataVersion,
    mcVersion: DATA_VERSION_MAP.get(dataVersion) || "",
    warnings: Array.isArray(schematic.warnings) ? schematic.warnings.length : 0,
  };
}
