import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const variants = [
  ['--enable-unsafe-swiftshader'],
  ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu'],
  ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
];
for (const extra of variants) {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', ...extra],
      defaultViewport: { width: 800, height: 600 },
    });
    const page = await browser.newPage();
    const r = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return { ok: false, why: 'no webgl2' };
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      // 真正画一帧并读像素，确认不是空上下文
      gl.clearColor(0.2, 0.4, 0.6, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return {
        ok: true,
        version: gl.getParameter(gl.VERSION),
        renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        px: Array.from(px),
      };
    });
    console.log(JSON.stringify({ args: extra.join(' '), ...r }));
  } catch (e) {
    console.log(JSON.stringify({ args: extra.join(' '), ok: false, err: e.message.slice(0, 120) }));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
