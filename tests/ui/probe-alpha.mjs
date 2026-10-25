#!/usr/bin/env node
// 采样 assets/atlas.png 里某个矩形区域的 alpha 分布（用于排查 cutout/translucent 判定）
// 用法：node tests/ui/probe-alpha.mjs <u0> <v0> <w> <h>

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "../..");
const [u0, v0, w, h] = process.argv.slice(2).map(Number);
const b64 = fs.readFileSync(path.join(PROJECT, "assets/atlas.png")).toString("base64");

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const result = await page.evaluate(
  async (b64, u0, v0, w, h) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(u0, v0, w, h).data;
    const buckets = {};
    let total = 0;
    const hist = new Array(11).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      hist[Math.min(10, Math.round(a / 25.5))]++;
      total++;
    }
    return { size: [img.width, img.height], hist, total };
  },
  b64, u0, v0, w, h
);
console.log(JSON.stringify(result));
await browser.close();
