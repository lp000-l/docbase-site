/* 便携版专页截图：桌面整页 + 手机整页 + 下载卡。默认打线上，预演时传本地地址：
   node shot-portable.cjs http://127.0.0.1:8899/portable.html */
const path = require('path');
const { chromium } = require('C:/Users/17760/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const OUT = 'D:\\.workbuddy\\work\\docbase-website\\docs-shot';
const URL_ = process.argv[2] || 'https://bishe.xin/portable.html';

(async () => {
  /* playwright-core 不带浏览器，要显式指向本机那份 Chromium（与 probe-site.cjs 同一路径） */
  const browser = await chromium.launch({ executablePath: 'C:/Users/17760/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
  for (const [tag, w, h, full] of [['桌面', 1440, 900, true], ['手机', 390, 844, true]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    /* 沙箱里访问不到 Google Fonts / jsDelivr，字体会一直等到超时 —— 直接掐掉外部请求，
       用本机回退字体看版式（线上照常加载真实字体）。 */
    /* 拦的是**外部 CDN**（字体等），不是页面本身 ——
       原来只放行 127.0.0.1，一换成线上地址就把 https://bishe.xin 也掐了，
       表象是 page.goto ERR_FAILED（很容易误判成"站点挂了"）。 */
    const own = new URL(URL_).host;
    await page.route('**/*', route => {
      const u = route.request().url();
      if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u) || new URL(u).host === own) return route.continue();
      return route.abort();
    });
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    /* 滚一遍把入场动效都触发（不然整页截图里会有没显现的块） */
    await page.evaluate(async () => {
      const html = document.documentElement;
      const old = html.style.scrollBehavior; html.style.scrollBehavior = 'auto';
      for (let y = 0; y <= document.body.scrollHeight; y += Math.round(window.innerHeight * 0.6)) {
        window.scrollTo(0, y); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 80)));
      }
      window.scrollTo(0, 0); html.style.scrollBehavior = old;
    });
    await page.waitForTimeout(900);
    const f = path.join(OUT, '便携版-' + tag + '-整页.png');
    await page.screenshot({ path: f, fullPage: full });
    console.log('✓ ' + f);
    /* 再单独截下载卡（给最终回复里用） */
    if (tag === '桌面') {
      const el = await page.$('#get .get-card');
      if (el) { await el.screenshot({ path: path.join(OUT, '便携版-下载卡.png') }); console.log('✓ 便携版-下载卡.png'); }
    }
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('截图失败：' + (e && e.message)); process.exit(1); });
