import puppeteer from "puppeteer-core";

const b = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--allow-file-access-from-files"],
});
const p = await b.newPage();
p.on("console", (m) => console.log("[console]", m.type(), m.text()));
p.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await p.goto("file:///D:/Github/tempproject/temp/mcviewer/tests/ui/panels.html?scenario=empty", { waitUntil: "load" });
await p.waitForFunction(() => window.__APP_READY__ === true, { timeout: 20000 });
console.log(
  JSON.stringify(
    await p.evaluate(() => {
      const card = document.querySelector(".pack-card");
      return {
        cardCls: card.className,
        tree: [...card.querySelectorAll("*")].map((el) => `${el.tagName.toLowerCase()}.${el.className}`).slice(0, 40),
        packEmptyTitles: document.querySelectorAll(".pack-card .pack-empty-title").length,
        allEmptyTitles: document.querySelectorAll(".pack-empty-title").length,
        innerText: card.innerText.slice(0, 400),
      };
    }),
    null,
    1
  )
);
await b.close();
