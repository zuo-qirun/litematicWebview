// 访问控制：可选 Bearer 令牌 + 写接口限速（防爆破/防刷）。
import { timingSafeEqual } from "node:crypto";

/** 令牌校验（不启用时恒通过） */
export function createAuth(token) {
  const enabled = Boolean(token && String(token).length >= 8);
  const expect = Buffer.from(String(token || ""));
  return {
    enabled,
    check(req) {
      if (!enabled) return true;
      const header = String(req.headers["authorization"] || "");
      let given = "";
      if (header.toLowerCase().startsWith("bearer ")) given = header.slice(7).trim();
      else {
        const url = String(req.url || "");
        const q = url.indexOf("?");
        if (q >= 0) {
          const params = new URLSearchParams(url.slice(q + 1));
          given = params.get("token") || "";
        }
      }
      if (!given) return false;
      const buf = Buffer.from(given);
      if (buf.length !== expect.length) return false;
      try {
        return timingSafeEqual(buf, expect);
      } catch {
        return false;
      }
    },
  };
}

/** 滑动窗口限速：默认 20 次 / 分钟 / IP */
export function createRateLimiter({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, list] of hits) {
      const keep = list.filter((t) => now - t < windowMs);
      if (keep.length) hits.set(ip, keep);
      else hits.delete(ip);
    }
  }, windowMs);
  cleanup.unref?.();

  return {
    /** @returns {{ok:boolean, retryAfter:number}} */
    take(ip) {
      const now = Date.now();
      const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
      if (list.length >= max) {
        const retryAfter = Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000));
        hits.set(ip, list);
        return { ok: false, retryAfter };
      }
      list.push(now);
      hits.set(ip, list);
      return { ok: true, retryAfter: 0 };
    },
  };
}
