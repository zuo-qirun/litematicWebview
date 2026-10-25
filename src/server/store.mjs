// 持久化存储：data/projects 与 data/packs 的索引 + 文件读写（单进程，串行化变更）。
import { promises as fsp } from "node:fs";
import { join, resolve } from "node:path";
import { isDir, newId, nowIso, readJson, writeJsonAtomic } from "./util.mjs";

export class StoreError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class Store {
  /** @param {{dataDir:string, limits?:object}} opts */
  constructor({ dataDir, limits = {} }) {
    this.dataDir = resolve(dataDir);
    this.projectsDir = join(this.dataDir, "projects");
    this.packsDir = join(this.dataDir, "packs");
    this.limits = {
      projects: limits.projects ?? 200,
      packs: limits.packs ?? 5,
      projectBytes: limits.projectBytes ?? 512 * 1024 * 1024,
      packBytes: limits.packBytes ?? 256 * 1024 * 1024,
    };
    this.projectIndex = { version: 1, items: [] };
    this.packIndex = { version: 1, items: [] };
    this._queue = Promise.resolve();
  }

  /** 串行执行写操作，避免并发上传互相踩索引 */
  _serial(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async init() {
    await fsp.mkdir(this.projectsDir, { recursive: true });
    await fsp.mkdir(this.packsDir, { recursive: true });
    this.projectIndex = await readJson(join(this.projectsDir, "index.json"), { version: 1, items: [] });
    this.packIndex = await readJson(join(this.packsDir, "index.json"), { version: 1, items: [] });
    if (!Array.isArray(this.projectIndex.items)) this.projectIndex.items = [];
    if (!Array.isArray(this.packIndex.items)) this.packIndex.items = [];
    // 上次进程中断的烘焙任务：标记失败，避免前端一直转圈
    let dirty = false;
    for (const pack of this.packIndex.items) {
      if (pack.status === "queued" || pack.status === "baking") {
        pack.status = "error";
        pack.message = "服务重启导致烘焙中断，请删除后重新上传";
        pack.progress = 0;
        dirty = true;
      }
    }
    if (dirty) await this._savePacks();
  }

  // ---------------- 投影库 ----------------

  projectStorage() {
    const items = this.projectIndex.items;
    return {
      count: items.length,
      bytes: items.reduce((a, p) => a + (p.size || 0), 0),
      maxBytes: this.limits.projectBytes,
      maxCount: this.limits.projects,
    };
  }

  listProjects() {
    return { items: [...this.projectIndex.items], storage: this.projectStorage() };
  }

  getProject(id) {
    return this.projectIndex.items.find((p) => p.id === id) || null;
  }

  projectFile(id) {
    return join(this.projectsDir, `${id}.litematic`);
  }

  /** 同名的自动加 (2)(3) 后缀 */
  _uniqueName(name, taken) {
    const used = new Set(this.projectIndex.items.map((p) => p.name));
    if (!used.has(name) || !taken.has(name)) return name;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 2; i < 1000; i++) {
      const cand = `${base} (${i})${ext}`;
      if (!used.has(cand)) return cand;
    }
    return `${base} (${Date.now()})${ext}`;
  }

  async addProject({ name, buffer, info }) {
    return this._serial(async () => {
      const storage = this.projectStorage();
      if (this.projectIndex.items.length >= this.limits.projects) {
        throw new StoreError("QUOTA_EXCEEDED", `投影数量已达上限（${this.limits.projects} 个），请先删除一些`, 409);
      }
      if (storage.bytes + buffer.length > this.limits.projectBytes) {
        throw new StoreError("QUOTA_EXCEEDED", "投影库总容量已满，请先删除一些投影", 409);
      }
      const id = newId(12);
      const finalName = this._uniqueName(name, new Set());
      const file = this.projectFile(id);
      await fsp.writeFile(file, buffer);
      const item = {
        id,
        name: finalName,
        size: buffer.length,
        blocks: info?.blocks ?? -1,
        regions: info?.regions ?? -1,
        author: info?.author ?? "",
        mcVersion: info?.mcVersion ?? "",
        dataVersion: info?.dataVersion ?? -1,
        createdAt: nowIso(),
        url: `/api/projects/${id}/file`,
      };
      this.projectIndex.items.unshift(item);
      try {
        await writeJsonAtomic(join(this.projectsDir, "index.json"), this.projectIndex);
      } catch (err) {
        this.projectIndex.items.shift();
        await fsp.rm(file, { force: true });
        throw new StoreError("STORAGE_ERROR", `写入索引失败：${err?.message || err}`, 500);
      }
      return item;
    });
  }

  async removeProject(id) {
    return this._serial(async () => {
      const idx = this.projectIndex.items.findIndex((p) => p.id === id);
      if (idx < 0) return false;
      this.projectIndex.items.splice(idx, 1);
      await fsp.rm(this.projectFile(id), { force: true });
      await writeJsonAtomic(join(this.projectsDir, "index.json"), this.projectIndex);
      return true;
    });
  }

  // ---------------- 材质包 ----------------

  packStorage() {
    const items = this.packIndex.items;
    return {
      count: items.length,
      bytes: items.reduce((a, p) => a + (p.size || 0), 0),
      maxBytes: this.limits.packBytes,
      maxCount: this.limits.packs,
    };
  }

  listPacks() {
    return { items: [...this.packIndex.items], storage: this.packStorage() };
  }

  getPack(id) {
    return this.packIndex.items.find((p) => p.id === id) || null;
  }

  packDir(id) {
    return join(this.packsDir, id);
  }

  packZip(id) {
    return join(this.packDir(id), "pack.zip");
  }

  packAssetsDir(id) {
    return join(this.packDir(id), "assets");
  }

  async addPack({ name, buffer, zipInfo }) {
    return this._serial(async () => {
      if (this.packIndex.items.length >= this.limits.packs) {
        throw new StoreError("QUOTA_EXCEEDED", `材质包数量已达上限（${this.limits.packs} 个），请先删除一些`, 409);
      }
      const storage = this.packStorage();
      if (storage.bytes + buffer.length > this.limits.packBytes) {
        throw new StoreError("QUOTA_EXCEEDED", "材质包总容量已满，请先删除一些", 409);
      }
      const id = newId(10);
      const dir = this.packDir(id);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(this.packZip(id), buffer);
      const item = {
        id,
        name,
        size: buffer.length,
        status: "queued",
        progress: 0,
        message: "",
        assetsUrl: "",
        stats: { entries: zipInfo?.entries?.length ?? 0, ...(zipInfo?.counts ?? {}) },
        createdAt: nowIso(),
      };
      this.packIndex.items.unshift(item);
      try {
        await writeJsonAtomic(join(this.packsDir, "index.json"), this.packIndex);
      } catch (err) {
        this.packIndex.items.shift();
        await fsp.rm(dir, { recursive: true, force: true });
        throw new StoreError("STORAGE_ERROR", `写入索引失败：${err?.message || err}`, 500);
      }
      return item;
    });
  }

  async updatePack(id, patch) {
    return this._serial(async () => {
      const item = this.packIndex.items.find((p) => p.id === id);
      if (!item) return null;
      Object.assign(item, patch);
      await this._savePacks();
      return item;
    });
  }

  async removePack(id) {
    return this._serial(async () => {
      const idx = this.packIndex.items.findIndex((p) => p.id === id);
      if (idx < 0) return false;
      this.packIndex.items.splice(idx, 1);
      await this._savePacks();
      await fsp.rm(this.packDir(id), { recursive: true, force: true });
      return true;
    });
  }

  async _savePacks() {
    await writeJsonAtomic(join(this.packsDir, "index.json"), this.packIndex);
  }

  /** 启动时检查资产是否齐全（烘焙产物） */
  async packAssetsReady(id) {
    return isDir(this.packAssetsDir(id));
  }
}
