// 极简 ZIP 元信息读取（只解析中央目录，不解压）：用于上传前的安全检查。
// 目的：在交给 Python 真正解压/烘焙之前，挡住 zip 炸弹、zip-slip、非法条目。
const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const ZIP64_MARK = 0xffffffff;

export class ZipError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** @returns {{entries:Array<{name:string,method:number,uncompressed:number,compressed:number,isDir:boolean}>,totalUncompressed:number,comment:string}} */
export function readZipDirectory(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new ZipError("INVALID_PACK", "不是有效的 zip 文件");
  // 从尾部向前找 EOCD（最多回退 64KB，兼容注释）
  const start = Math.max(0, buf.length - 0xffff - 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("INVALID_PACK", "zip 缺少中央目录（可能不是 zip 或已损坏）");

  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === ZIP64_MARK || cdOffset === ZIP64_MARK) {
    throw new ZipError("UNSUPPORTED_PACK", "不支持 ZIP64 格式的材质包，请重新打包为普通 zip");
  }
  if (cdOffset + cdSize > buf.length) throw new ZipError("INVALID_PACK", "zip 中央目录越界（文件被截断？）");

  const entries = [];
  let offset = cdOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < total; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CD_SIG) {
      throw new ZipError("INVALID_PACK", `zip 中央目录第 ${i + 1} 项损坏`);
    }
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const uncompressed = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    if (compressed === ZIP64_MARK || uncompressed === ZIP64_MARK) {
      throw new ZipError("UNSUPPORTED_PACK", "不支持 ZIP64 条目，请重新打包为普通 zip");
    }
    const nameBuf = buf.subarray(offset + 46, offset + 46 + nameLen);
    const name = nameBuf.toString(flags & 0x800 ? "utf8" : "latin1");
    offset += 46 + nameLen + extraLen + commentLen;
    const isDir = name.endsWith("/") || name.endsWith("\\");
    entries.push({ name, method, uncompressed, compressed, isDir });
    if (!isDir) totalUncompressed += uncompressed;
  }
  return { entries, totalUncompressed };
}

/** 把 zip 条目名归一化成「以斜杠分隔、无 ./、无 ..、无盘符」的相对路径；非法返回 null */
export function normalizeEntryName(name) {
  let n = String(name).replace(/\\/g, "/");
  if (n.includes("\0")) return null;
  if (n.startsWith("/")) return null;
  if (/^[a-zA-Z]:/.test(n)) return null;
  const parts = [];
  for (const seg of n.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  return parts.join("/");
}

/**
 * 找出 zip 内 assets/ 的根前缀（很多材质包外面多套一层文件夹）。
 * @returns {string} 例如 "" 或 "MyPack/"
 */
export function findAssetsPrefix(entries) {
  const names = entries.map((e) => normalizeEntryName(e.name)).filter(Boolean);
  if (names.some((n) => n.startsWith("assets/"))) return "";
  const hit = names.find((n) => n.includes("/assets/"));
  if (!hit) return "";
  return hit.slice(0, hit.indexOf("/assets/") + 1);
}

/**
 * 材质包安全校验。
 * @param {Buffer} buf
 * @param {{maxEntries?:number,maxUncompressed?:number}} opts
 */
export function validatePackZip(buf, opts = {}) {
  const maxEntries = opts.maxEntries ?? 5000;
  const maxUncompressed = opts.maxUncompressed ?? 256 * 1024 * 1024;
  const dir = readZipDirectory(buf);
  if (dir.entries.length === 0) throw new ZipError("INVALID_PACK", "zip 是空的");
  if (dir.entries.length > maxEntries) {
    throw new ZipError("INVALID_PACK", `zip 条目过多（${dir.entries.length} > ${maxEntries}）`);
  }
  if (dir.totalUncompressed > maxUncompressed) {
    throw new ZipError("INVALID_PACK", `zip 解压后体积过大（${dir.totalUncompressed} 字节 > ${maxUncompressed}）`);
  }
  const prefix = findAssetsPrefix(dir.entries);
  const packEntries = [];
  for (const e of dir.entries) {
    const norm = normalizeEntryName(e.name);
    if (norm === null) throw new ZipError("INVALID_PACK", `zip 含非法路径：${e.name}`);
    if (!norm.startsWith(`${prefix}assets/`)) continue;
    packEntries.push({ ...e, path: norm.slice(prefix.length) });
  }
  if (packEntries.length === 0) {
    throw new ZipError("INVALID_PACK", "zip 内没有 assets/minecraft 资源（这不像 Minecraft 资源包）");
  }
  const hasContent = packEntries.some(
    (e) =>
      /^assets\/minecraft\/(blockstates|models)\/.+\.json$/i.test(e.path) ||
      /^assets\/minecraft\/textures\/.+\.png$/i.test(e.path),
  );
  if (!hasContent) {
    throw new ZipError("INVALID_PACK", "资源包里没有可用的 blockstates / models / textures");
  }
  return {
    prefix,
    entries: packEntries,
    totalUncompressed: dir.totalUncompressed,
    counts: {
      json: packEntries.filter((e) => e.path.endsWith(".json")).length,
      png: packEntries.filter((e) => e.path.endsWith(".png")).length,
    },
  };
}
