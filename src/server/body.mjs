// 请求体读取：硬上限 + 超时 + content-length 预检，防止内存打爆。
export class BodyError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * 读取原始请求体。
 * @param {import('node:http').IncomingMessage} req
 * @param {{limit:number, timeoutMs?:number}} opts
 * @returns {Promise<Buffer>}
 */
export function readBody(req, { limit, timeoutMs = 60_000 }) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    return Promise.reject(new BodyError("PAYLOAD_TOO_LARGE", `请求体超过上限（${limit} 字节）`, 413));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      req.destroy();
      reject(new BodyError("REQUEST_TIMEOUT", "上传超时", 408));
    }, timeoutMs);
    timer.unref?.();

    const finish = (err, buf) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      if (err) reject(err);
      else resolve(buf);
    };

    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        finish(new BodyError("PAYLOAD_TOO_LARGE", `请求体超过上限（${limit} 字节）`, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks, size));
    const onError = (err) => finish(new BodyError("UPLOAD_ABORTED", err?.message || "上传中断", 400));

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

/**
 * 从 x-file-name 头读取文件名。
 * 前端有两种写法都支持：呼 encodeURIComponent 编码后的形式（契约推荐），
 * 以及直接塞 UTF-8 字节的写法（curl / 部分客户端，Node 会按 latin1 解出乱码）。
 */
export function fileNameFromHeader(req, fallback = "") {
  const header = req.headers["x-file-name"];
  if (!header) return fallback;
  const raw = String(header);

  // 1) 百分号编码：decodeURIComponent 优先
  if (raw.includes("%")) {
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded && !decoded.includes("\uFFFD")) return decoded;
    } catch {
      /* 落到下一步 */
    }
  }

  // 2) 头部原始字节被当成 latin1 解出来的 UTF-8：转回 UTF-8
  if (/[\u0080-\u00ff]/.test(raw)) {
    try {
      const buf = Buffer.from(raw, "latin1");
      const utf8 = buf.toString("utf8");
      if (!utf8.includes("\uFFFD")) return utf8;
    } catch {
      /* ignore */
    }
  }

  return raw;
}

/** 取客户端地址（用于限速）；绑定 127.0.0.1 时就是本机 */
export function clientIp(req) {
  const addr = req.socket?.remoteAddress || "unknown";
  return addr.startsWith("::ffff:") ? addr.slice(7) : addr;
}
