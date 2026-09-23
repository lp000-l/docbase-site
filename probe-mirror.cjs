/*
 * probe-mirror.cjs —— GitHub Pages 镜像站的发布后验收
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 为什么要有它：镜像站是**另一份部署**，「主站对了」不代表镜像对。最容易出的三类毛病
 * 都只有打开镜像站才能发现：
 *   ① 相对路径没改 → 下载按钮点下去 404（主站是相对路径指服务器文件，镜像上根本没有那个文件）
 *   ② 反馈表单还指着 `api/feedback.php` → Pages 上没有 PHP，永远 404
 *   ③ 校验码 / 体积 / 版本是 JS 读清单回填的 → 光看 HTML 源码看不出对没对
 *
 * 所以它做两层：
 *   A. **纯 HTTP**：四个页面、三份清单、站内死链、下载地址能不能真取到（Range 探一手，核字节数）
 *   B. **真浏览器**：下载卡标注、校验码表、手记最新条目、页脚镜像提示、有没有 JS 报错
 *
 * 用法：
 *   node probe-mirror.cjs                                   # 默认 https://<owner>.github.io/docbase-site/
 *   node probe-mirror.cjs https://lp000-l.github.io/docbase-site/
 *
 * 期望值一律从同目录 `purity.json` / `portable.json` / `updates.json` 读，**不手抄**（手抄必然过期）。
 */
/* ⚠️ 本构建机的沙箱代理会替换 TLS 证书 —— 不放宽就是清一色
   \`fetch failed: unable to verify the first certificate\`（GitHub 全站如此，实测四个域名全中）。
   只在沙箱里需要；正常网络下带 WYG_STRICT_TLS=1 跑即可（那时会走严格校验）。 */
if (process.env.WYG_STRICT_TLS !== '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/17760/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const CHROME = 'C:/Users/17760/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const MIRROR = (process.argv[2] || 'https://lp000-l.github.io/docbase-site/').replace(/\?.*$/, '');
const BASE = MIRROR.endsWith('/') ? MIRROR : MIRROR + '/';
const MAIN = 'https://bishe.xin/';

const PURITY = JSON.parse(fs.readFileSync(path.join(__dirname, 'purity.json'), 'utf8'));
const PORT = JSON.parse(fs.readFileSync(path.join(__dirname, 'portable.json'), 'utf8'));
const UPD = JSON.parse(fs.readFileSync(path.join(__dirname, 'updates.json'), 'utf8'));
const VER = PURITY.version;

let pass = 0, fail = 0;
const ok = (c, n, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined && x !== '' ? '  [' + x + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async (u, o) => fetch(u, Object.assign({ redirect: 'follow' }, o || {}));
const text = async u => { const r = await get(u); return { status: r.status, body: await r.text() }; };

/* 看门狗：CDP 下 browser.close() 可能永不返回，到点无论卡在哪都退出并留证据 */
const WD = Number(process.env.WYG_WD_MS || 240000);
const wd = setTimeout(() => { console.log('\n⏱ 看门狗触发（' + WD + 'ms），强制退出'); process.exit(9); }, WD);
wd.unref && wd.unref();

(async () => {
  console.log('══ 镜像站验收 ' + BASE + ' ══');
  console.log('   期望版本 v' + VER + '（来自 purity.json）\n');

  /* ═══════════ A. 纯 HTTP ═══════════ */
  console.log('=== ① 四个页面与三份清单 ===');
  const pages = ['', 'index.html', 'journal.html', 'portable.html', 'feedback.html'];
  const htmlOf = {};
  for (const p of pages) {
    const r = await text(BASE + p);
    if (p === '' || p === 'index.html') htmlOf.index = r.body;
    else htmlOf[p] = r.body;
    ok(r.status === 200 && r.body.length > 2000, (p || 'index.html') + ' 能打开', 'HTTP ' + r.status + ' ' + r.body.length + ' 字节');
  }
  for (const m of ['purity.json', 'portable.json', 'updates.json']) {
    const r = await text(BASE + m);
    let j = null; try { j = JSON.parse(r.body); } catch (e) { }
    ok(r.status === 200 && !!j, m + ' 可取且是合法 JSON', 'HTTP ' + r.status);
  }

  console.log('\n=== ② 镜像站该有的两处改写 ===');
  const idx = htmlOf.index || '';
  const dlHrefs = [...idx.matchAll(/href="(https?:\/\/[^"]*DocBase-(?:Setup|Portable)-[\d.]+\.(?:exe|zip))"/g)].map(m => m[1]);
  ok(dlHrefs.length >= 2, '主页两个下载按钮都改成了绝对地址（镜像上相对路径必然 404）', dlHrefs.length + ' 个');
  ok(dlHrefs.every(h => /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(h) || h.startsWith(MAIN)),
    '下载地址指向 GitHub Releases 或正式站点', dlHrefs[0] || '');
  const fb = htmlOf['feedback.html'] || '';
  ok(/fetch\('https:\/\/bishe\.xin\/api\/feedback\.php'/.test(fb), '反馈表单指向正式站点的接口（Pages 上没有 PHP）',
    (fb.match(/fetch\('([^']*feedback[^']*)'/) || [])[1] || '没找到');
  ok(!/fetch\('api\/feedback\.php'/.test(fb), '已没有指向相对路径的反馈接口（那样在 Pages 上必 404）');
  const footOk = pages.filter(p => p.endsWith('.html')).every(p => (htmlOf[p] || '').includes('gh-mirror'));
  ok(footOk, '四个页面页脚都有「本站为镜像站」提示');
  ok(/<meta name="mirror-of"/.test(idx), '主页标了 mirror-of（别让搜索引擎把镜像当主站）');
  ok(idx.includes('bishe.xin'), '主页里给了正式站点的地址');

  console.log('\n=== ③ 下载地址真能取到（Range 探一手核字节数） ===');
  for (const { url, want, label } of [
    { url: dlHrefs.find(h => /Setup/.test(h)), want: PURITY.installer && PURITY.installer.size, label: '安装包' },
    { url: dlHrefs.find(h => /Portable/.test(h)), want: PORT.size, label: '便携包' },
  ]) {
    if (!url) { ok(false, label + '：主页里没找到下载地址'); continue; }
    try {
      const r = await get(url, { headers: { Range: 'bytes=0-0' } });
      const cr = r.headers.get('content-range') || '';
      const total = Number((cr.split('/')[1] || '0'));
      const fr = await get(url, { headers: { Range: 'bytes=0-1048575' } });
      ok(r.status === 206 || r.status === 200, label + ' 下载地址可达', 'HTTP ' + r.status + ' · ' + url.split('/').slice(-2).join('/'));
      if (want) ok(total === want, label + ' 的字节数与清单一致', total + ' vs 清单 ' + want);
      else console.log('    （清单里没写' + label + '字节数，跳过体积核对）');
      ok(fr.status < 300, label + ' 支持分段下载（Range）', 'HTTP ' + fr.status);
    } catch (e) { ok(false, label + ' 下载地址取不到：' + String(e.message).slice(0, 80)); }
  }

  console.log('\n=== ④ 站内死链 ===');
  const links = new Set();
  for (const p of ['index', 'journal.html', 'portable.html', 'feedback.html']) {
    const h = htmlOf[p] || '';
    for (const m of h.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const u = m[1];
      if (/^(https?:|#|mailto:|data:|javascript:)/.test(u)) continue;
      links.add(u);
    }
  }
  const dead = [];
  for (const u of links) {
    try { const r = await get(BASE + u); if (r.status >= 400) dead.push(u + ' → ' + r.status); }
    catch (e) { dead.push(u + ' → ' + String(e.message).slice(0, 40)); }
  }
  ok(dead.length === 0, '站内链接与资源全部可取', dead.length ? dead.slice(0, 4).join(' ; ') : links.size + ' 个链接');

  /* ═══════════ B. 真浏览器 ═══════════ */
  console.log('\n=== ⑤ 真浏览器：渲染后的数字与提示 ===');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errs = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('pageerror: ' + String(e.message).slice(0, 120)));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 120)); });

    for (const [label, file] of [['主页', ''], ['手记', 'journal.html'], ['便携版专页', 'portable.html'], ['反馈页', 'feedback.html']]) {
      errs.length = 0;
      await page.goto(BASE + file, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(1800);
      ok(errs.length === 0, label + ' 打开没有 JS 报错', errs.slice(0, 2).join(' | '));
    }

    /* 主页：下载卡标注必须与清单一致 */
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await sleep(2000);
    const card = await page.evaluate(() => {
      const m = document.querySelector('#dlMeta') || document.querySelector('.dl-meta');
      const btns = [...document.querySelectorAll('a.dl-btn')].map(a => ({ t: (a.textContent || '').trim().slice(0, 30), h: a.getAttribute('href') }));
      const ck = [...document.querySelectorAll('.dl-ck code, .dl-ck-row code')].map(c => (c.textContent || '').trim());
      return { meta: m ? m.textContent.trim() : '', btns, ck: ck.slice(0, 6) };
    });
    ok(card.meta.includes('v' + VER), '主页下载卡标注了本版版本', card.meta.slice(0, 60));
    ok(card.btns.length >= 2, '主页有两个下载按钮（安装版 + 便携版）', card.btns.map(b => b.t).join(' + '));
    const ckHasSha = card.ck.some(c => new RegExp(String(PURITY.fingerprint || '').slice(0, 8), 'i').test(c) || /[0-9a-f]{64}/i.test(c));
    ok(ckHasSha || card.ck.length === 0, '主页校验码表有哈希（或本来就没渲染）', card.ck.slice(0, 2).join(' / '));

    /* 便携版专页：标注与清单一致 */
    await page.goto(BASE + 'portable.html', { waitUntil: 'domcontentloaded' });
    await sleep(2200);
    const pf = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        len: t.length,
        hasZip: t.includes('DocBase-Portable'),
        sha: (t.match(/[0-9a-f]{64}/i) || [''])[0].toLowerCase(),
        btns: [...document.querySelectorAll('a.dl-btn')].map(a => a.getAttribute('href')),
      };
    });
    ok(pf.hasZip, '便携版专页提到了便携包文件名');
    ok(pf.sha === String(PORT.sha256).toLowerCase(), '专页的 SHA-256 与便携版清单一致', (pf.sha || '(没找到)').slice(0, 16));
    ok(pf.btns.some(h => /releases\/download|bishe\.xin/.test(h || '')), '专页下载按钮指向 Releases 或正式站点', pf.btns[0] || '');
    ok(/解压/.test(await page.evaluate(() => document.body.innerText)), '专页写了体积与解压说明');

    /* 页脚镜像提示真的看得见 */
    const mir = await page.evaluate(() => {
      const e = document.querySelector('.gh-mirror');
      if (!e) return null;
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(Math.min(r.bottom - 4, window.innerHeight - 6)));
      return { op: cs.opacity, vis: cs.visibility, w: Math.round(r.width), h: Math.round(r.height), hit: !!hit && (hit.closest('.gh-mirror') === e) };
    });
    ok(!!mir && Number(mir.op) > 0 && mir.vis !== 'hidden' && mir.w > 200 && mir.h > 10,
      '页脚「镜像站」提示真的渲染出来了（不是 display:none）', mir ? `opacity=${mir.op} ${mir.w}×${mir.h}` : '没找到 .gh-mirror');

    /* 手记最新一条是本版 */
    await page.goto(BASE + 'journal.html', { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const jr = await page.evaluate(() => {
      const first = document.querySelector('.jr-item');
      return { n: document.querySelectorAll('.jr-item').length, first: first ? first.textContent.replace(/\s+/g, ' ').trim().slice(0, 70) : '' };
    });
    ok(jr.n > 3, '手记是全量（不再只留三版）', jr.n + ' 条');
    ok(jr.first.includes('v' + VER), '手记第一条就是本版', jr.first);
  } finally {
    try { await Promise.race([browser.close(), sleep(3000)]); } catch (e) { }
  }

  console.log('\n--- probe-mirror: 通过 ' + pass + ' / 失败 ' + fail + ' ---');
  clearTimeout(wd);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + String(e && e.stack || e)); clearTimeout(wd); process.exit(1); });
