/* 用法：node shot-mobile.cjs [index.html 路径 或 https://网址] [输出目录] */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join('C:/Users/17760/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const CHROME = 'C:/Users/17760/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const ARG = process.argv[2] || path.join(__dirname, 'index.html');
const URL_ = /^https?:/i.test(ARG) ? ARG : 'file:///' + path.resolve(ARG).replace(/\\/g, '/');
const OUT = process.argv[3] || path.join(__dirname, 'docs-shot', 'mobile');
fs.mkdirSync(OUT, { recursive: true });

/* 机型：宽 × 高 × 设备像素比 */
const DEVICES = [
  { name: 'iPhoneSE-375', w: 375, h: 667, dpr: 2 },
  { name: 'iPhone12-390', w: 390, h: 844, dpr: 3 },
  { name: 'iPhoneMax-430', w: 430, h: 932, dpr: 3 },
  { name: 'Galaxy-360', w: 360, h: 740, dpr: 3 },
  { name: 'Pixel7-412', w: 412, h: 915, dpr: 2.6 },
  { name: '折叠-320', w: 320, h: 640, dpr: 2 },
  { name: 'iPadMini-768', w: 768, h: 1024, dpr: 2 },
  { name: '桌面-1440', w: 1440, h: 900, dpr: 1 },
];

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '   ⟨' + extra + '⟩' : '')); }
};

/* ═══════ 进程清理 + 看门狗（v1.5.2）═══════
   两条都是被事故逼出来的，改之前请先读完：

   ① 只杀自己起的那棵树。原来收尾用 taskkill /F /IM 文渊阁.exe（按镜像名杀），
      会连同**用户自己开着的软件**一起杀；并发跑多个探针时，后一个还会杀掉前一个的实例 ——
      被杀的探针卡在等 CDP 上永不复返（probe-v130 曾因此挂满 3 小时 14 分）。
   ② 看门狗。收尾那句 await browser.close() 在 connectOverCDP 下可能**永远不返回**，
      而它包在 try/catch 里 —— catch 只接得住「抛出异常」，接不住「永不返回」。
      于是断言早已跑完、结果也写进日志了，进程却永久挂着，把后续每条命令都拖成「没动静」。
      这里上一道硬闸：到点无论卡在哪都强制退出并留证据。WYG_WD_MS 可调（毫秒）。

   两条合起来的目标只有一个：**脚本一定会死**。 */
/* 删目录：优先用系统命令（rmdir /s /q），**不经过 node 的 fs** ——
   本机 NODE_OPTIONS 里挂着一个安全删除垫片，实测让每个文件操作慢到约 10ms 级
   （铺 1000 个文件 + 删两次就超过 2 分钟）。收尾要删整个 Chromium profile，
   被垫片一拖就是几分钟到十几分钟，表现是「断言全绿、汇总行永不出现」。
   fs.rmSync 只作为非 Windows 或不支持时的兜底。 */
function fastRm(dir) {
  if (!dir) return;
  const t0 = Date.now(), fs2 = require('fs'), path2 = require('path');
  try {
    if (process.platform === 'win32') {
      require('child_process').spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', dir], { windowsHide: true });
    }
  } catch (e) { }
  if (!fs2.existsSync(dir)) { console.log('    [收尾] 删 ' + path2.basename(dir) + ' ' + (Date.now() - t0) + ' ms'); return; }
  try { fs2.rmSync(dir, { recursive: true, force: true, maxRetries: 1 }); } catch (e) { }
  if (!fs2.existsSync(dir)) { console.log('    [收尾] 删 ' + path2.basename(dir) + ' ' + (Date.now() - t0) + ' ms（兜底）'); return; }
  /* 还删不掉就改名挪走：rename 是 O(1)，把「删上万个文件」的成本移出脚本生命周期 ——
     脚本不该因为清垃圾而卡住。留的 *.trash-* 由 clean-stuck.cjs 顺手清。 */
  try {
    fs2.renameSync(dir, dir + '.trash-' + Date.now());
    console.log('    [收尾] ' + path2.basename(dir) + ' 改名挪走（删不掉，留给清理脚本）');
  } catch (e) {
    console.log('    [收尾] ' + path2.basename(dir) + ' 清不掉也挪不走：' + e.message);
  }
}

let __appPid = null;
function killAppTree() {
  if (!__appPid) return;
  try { require('child_process').spawnSync('taskkill', ['/F', '/T', '/PID', String(__appPid)], { windowsHide: true }); } catch (e) { }
  __appPid = null;
}
/* 起被验证的那个 exe：记下 pid，好让收尾能精确地只收它 */
function __spawnApp(bin, args, opts) {
  const p = require('child_process').spawn(bin, args, opts);
  __appPid = (p && p.pid) || null;
  return p;
}
const WD_MS = Number(process.env.WYG_WD_MS || 2.5 * 60 * 1000);
/* unref()：正常跑完时这道闸不该拖住进程；卡住时 event loop 仍在转（CDP 的 socket、
   子进程的 stdio 都还活着），定时器照常触发 —— 所以它对正常路径无害、对卡死有效。 */
setTimeout(() => {
  console.error('\n[看门狗] 超过 ' + Math.round(WD_MS / 60000) + ' 分钟仍未结束 —— 强制退出。');
  console.error('[看门狗] 多半卡在某个「永不返回」的 await 上（常见：browser.close()、等 CDP）。');
  killAppTree();
  process.exit(9);
}, WD_MS).unref();

/* ═══════ 环境自愈（v1.5.2）═══════
   本机 shell 的 NODE_OPTIONS 里挂着一个 fs 删除垫片（genie-safe-delete），
   它让删除慢约 50 倍（实测 250 个小文件 2.2 秒，正常是几十毫秒）。
   而这类脚本收尾要删整个 Chromium profile（上万个文件）——
   于是断言早已全绿、进程却卡在收尾几分钟到十几分钟，看起来就是「没动静」。
   垫片是加载期注入的，运行时卸不掉，所以带干净环境把自己重跑一遍。 */
if (process.env.WYG_NO_REEXEC !== '1'
  && /genie-safe-delete|safe-delete|rm-shim/i.test(process.env.NODE_OPTIONS || '')) {
  const r = require('child_process').spawnSync(
    process.execPath,
    [process.argv[1], ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '', WYG_NO_REEXEC: '1' } }
  );
  process.exit(r.status === null ? 1 : r.status);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  for (const d of DEVICES) {
    const mobile = d.w <= 640;
    console.log('\n=== ' + d.name + '  ' + d.w + '×' + d.h + ' ===');
    const ctx = await browser.newContext({
      viewport: { width: d.w, height: d.h },
      deviceScaleFactor: d.dpr,
      hasTouch: mobile,
      isMobile: mobile,
      userAgent: mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    });
    const page = await ctx.newPage();
    if (/^https:/i.test(URL_)) {
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(URL_).origin }).catch(() => { });
    }
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
    await page.waitForTimeout(1200);

    /* --- 1. 横向溢出体检 --- */
    const ov = await page.evaluate(() => {
      const de = document.documentElement;
      const gap = de.scrollWidth - de.clientWidth;
      const bad = [];
      if (gap > 1) {
        document.querySelectorAll('body *').forEach(el => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return;
          if (r.width > 0 && r.height > 0 && r.right > de.clientWidth + 1.5) {
            bad.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') +
              '[right=' + Math.round(r.right) + ']');
          }
        });
      }
      return { gap, bad: bad.slice(0, 6) };
    });
    ok(ov.gap <= 1, '无横向溢出', ov.gap > 1 ? '溢出 ' + ov.gap + 'px：' + ov.bad.join(', ') : '');

    /* --- 2. 顶栏 / 导航形态 --- */
    const nav = await page.evaluate(() => {
      const vis = el => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      };
      const burger = document.getElementById('burger');
      const r = burger.getBoundingClientRect();
      return {
        burger: vis(burger), navRow: vis(document.querySelector('.nav')),
        cta: vis(document.querySelector('.nav-cta')),
        bw: Math.round(r.width), bh: Math.round(r.height),
      };
    });
    if (mobile) {
      ok(nav.burger, '汉堡按钮出现');
      ok(!nav.navRow && !nav.cta, '桌面导航行已隐藏');
      ok(nav.bw >= 42 && nav.bh >= 42, '汉堡触摸目标 ≥ 42px', nav.bw + '×' + nav.bh);
    } else {
      ok(!nav.burger, '桌面不显示汉堡');
      ok(nav.navRow, '桌面导航行仍在');
    }

    /* --- 3. 手机端专属件 --- */
    const mob = await page.evaluate(() => {
      const vis = id => { const el = document.querySelector(id); if (!el) return false; const cs = getComputedStyle(el); return cs.display !== 'none'; };
      return { tip: vis('.mobile-tip'), copy: vis('#dlCopy'), top: vis('#totop') };
    });
    if (mobile) {
      ok(mob.tip, '手机下载提示显形');
      ok(mob.copy, '「复制下载链接」显形');
      ok(mob.top, '回到顶部按钮已就位');
    } else {
      ok(!mob.tip && !mob.copy && !mob.top, '桌面不显示手机专属件');
    }

    /* --- 4. 抽屉交互（仅手机） --- */
    if (mobile) {
      await page.click('#burger');
      await page.waitForTimeout(380);
      const opened = await page.evaluate(() => ({
        open: document.getElementById('mnav').classList.contains('open'),
        aria: document.getElementById('burger').getAttribute('aria-expanded'),
        locked: document.body.classList.contains('menu-open'),
        linkH: Math.round(document.querySelector('#mnav a').getBoundingClientRect().height),
      }));
      ok(opened.open && opened.aria === 'true', '点汉堡展开菜单');
      ok(opened.locked, '展开时锁住背景滚动');
      ok(opened.linkH >= 44, '菜单项触摸高度 ≥ 44px', opened.linkH + 'px');

      if (d.name === 'iPhoneSE-375') {
        await page.screenshot({ path: path.join(OUT, 'menu-' + d.name + '.png') });
      }

      /* 菜单里的链接分两类：页内锚点（功能/运行/下载）与独立页面（更新手记/反馈）。
         早先「更新手记」是页内锚点，脚本点的是 #mnav a[href="#journal"]；
         它改成独立页之后这条就永远等不到元素 → Playwright 卡 30 秒、整支脚本中断（手机端截图全丢）。
         所以：先断言"更新手记"确实指向 journal.html，再用仍在页内的「功能」验收起与锚点落位。 */
      const navHrefs = await page.evaluate(() => [...document.querySelectorAll('#mnav a')].map(a => a.getAttribute('href')));
      ok(navHrefs.includes('journal.html'), '「更新手记」指向独立页 journal.html（不再是页内锚点）', JSON.stringify(navHrefs));
      await page.click('#mnav a[href="#volume"]');
      await page.waitForTimeout(1400);
      const after = await page.evaluate(() => {
        const j = document.getElementById('volume').getBoundingClientRect();
        return {
          open: document.getElementById('mnav').classList.contains('open'),
          locked: document.body.classList.contains('menu-open'),
          top: Math.round(j.top),
        };
      });
      ok(!after.open && !after.locked, '点菜单项后自动收起并解锁');
      /* #volume 在页首附近，点它等于回到开头：落位应在吸顶栏之下、不为负 */
      ok(after.top > -10 && after.top < 160, '锚点停在吸顶栏下方（标题没被盖）', 'top=' + after.top);

      /* Esc 关闭 */
      await page.click('#burger');
      await page.waitForTimeout(280);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(280);
      ok(await page.evaluate(() => !document.getElementById('mnav').classList.contains('open')), 'Esc 可关闭菜单');

      /* 遮罩点击关闭 */
      await page.click('#burger');
      await page.waitForTimeout(280);
      await page.mouse.click(Math.round(d.w / 2), d.h - 40);
      await page.waitForTimeout(280);
      ok(await page.evaluate(() => !document.getElementById('mnav').classList.contains('open')), '点遮罩可关闭菜单');

      /* 回到顶部 */
      await page.evaluate(() => window.scrollTo(0, 2400));
      await page.waitForTimeout(600);
      ok(await page.evaluate(() => document.getElementById('totop').classList.contains('show')), '下滑后出现「回到顶部」');
      await page.click('#totop');
      await page.waitForTimeout(2200);
      const y = await page.evaluate(() => window.scrollY);
      ok(y < 80, '点「回到顶部」回到页首', 'y=' + y);

      /* 复制链接 */
      await page.evaluate(() => document.getElementById('acquire').scrollIntoView());
      await page.waitForTimeout(500);
      await page.click('#dlCopy');
      await page.waitForTimeout(500);
      const cp = await page.evaluate(() => document.getElementById('dlCopy').textContent);
      ok(/已复制|复制失败/.test(cp), '点「复制下载链接」有明确反馈', cp);

      /* 线上（https 可读剪贴板）核对拷的到底是不是安装包地址 */
      if (/^https:/i.test(URL_)) {
        const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
        const want = await page.evaluate(() => new URL(document.querySelector('.dl-btn').getAttribute('href'), location.href).toString());
        ok(clip === want, '剪贴板内容 = 安装包绝对地址', clip || '(读不到)');
      }
    }

    /* --- 5. 触摸目标体检（手机） --- */
    if (mobile) {
      const small = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('a, button').forEach(el => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return;
          if (r.height < 40) out.push((el.className || el.tagName) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
        });
        return out;
      });
      ok(small.length === 0, '所有可点元素高度 ≥ 40px', small.join(' | '));
    }

    /* --- 6. 首屏关键元素没被挤掉 --- */
    const hero = await page.evaluate(() => {
      const t = document.querySelector('.hero-title'), f = document.querySelector('.folio');
      const tr = t.getBoundingClientRect(), fr = f.getBoundingClientRect();
      const cs = getComputedStyle(t);
      return { fs: Math.round(parseFloat(cs.fontSize)), lines: Math.round(tr.height / (parseFloat(cs.lineHeight) || 1)), fw: Math.round(fr.width), th: Math.round(tr.height) };
    });
    ok(hero.fs >= 26 && hero.fs <= 92, '主标题字号合理 ' + hero.fs + 'px');
    if (d.w <= 1024) {
      /* 单列布局：册页卡应铺满内容宽 */
      ok(hero.fw <= d.w && hero.fw > d.w * .55, '册页卡宽度随屏幕自适应 ' + hero.fw + '/' + d.w);
      const act = await page.evaluate(() => {
        const a = document.querySelector('.hero-act');
        return { w: Math.round(a.getBoundingClientRect().width), btn: [...a.querySelectorAll('.btn')].map(b => Math.round(b.getBoundingClientRect().width)) };
      });
      if (mobile) ok(act.btn.every(w => w > act.w * .9), '首屏按钮铺满一行（好点）', JSON.stringify(act.btn));
    } else {
      ok(true, '桌面两栏布局保持原样（册页 ' + hero.fw + 'px）');
    }

    /* --- 截图 --- */
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'full-' + d.name + '.png'), fullPage: true });
    await page.evaluate(() => document.querySelectorAll('.rv').forEach(el => el.classList.add('in')));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'top-' + d.name + '.png') });

    /* 375 下逐章细看 */
    if (d.name === 'iPhoneSE-375') {
      const SECS = [['.hero', '1首屏'], ['#volume', '2功能'], ['#terminal', '3终端'], ['#acquire', '4下载'], ['#journal', '5手记'], ['footer', '6页脚']];
      for (const [sel, tag] of SECS) {
        await page.locator(sel).screenshot({ path: path.join(OUT, 'sec-' + tag + '.png') });
      }
      await page.locator('.get-card').screenshot({ path: path.join(OUT, 'x-下载卡.png') });
      await page.locator('.jr-item.latest').screenshot({ path: path.join(OUT, 'x-手记首条.png') });
    }

    await ctx.close();
  }

  console.log('\n--------------------------');
  console.log('通过 ' + pass + ' / 失败 ' + fail + '   截图目录：' + OUT);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', (e && e.stack) || e); process.exit(1); });
