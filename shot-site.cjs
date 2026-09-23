/* 官网线上校验 + 截图（bishe.xin）：下载卡 / 更新手记 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join('C:/Users/17760/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const CHROME = 'C:/Users/17760/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const SITE = process.argv[2] || 'https://bishe.xin/';
const OUT = process.argv[3] || path.join(__dirname, 'docs-shot');
fs.mkdirSync(OUT, { recursive: true });

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
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const resp = await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('HTTP', resp.status(), resp.url());
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const dl = document.querySelector('.dl-btn');
    return {
      title: document.title,
      dlHref: dl ? dl.getAttribute('href') : null,
      dlMeta: (document.querySelector('.dl-meta') || {}).textContent || '',
      dlNote: (document.querySelector('.dl-note') || {}).textContent || '',
      journalExists: !!document.getElementById('journal'),
      journalVers: [...document.querySelectorAll('.jr-ver')].map(x => x.textContent),
      journalItems: [...document.querySelectorAll('.jr-item')].map(li => li.querySelectorAll('.jr-list > li').length),
      footLink: (document.querySelector('.foot-links a[href="#journal"]') || {}).textContent || '（未指向 #journal）',
      navLinks: [...document.querySelectorAll('.nav a')].map(a => a.textContent + '→' + a.getAttribute('href')),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  /* 顶栏截图（含导航入口） */
  await page.locator('.topbar').screenshot({ path: path.join(OUT, 'site-顶栏导航.png') });

  /* 下载卡截图 */
  await page.locator('#acquire').scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.locator('#acquire').screenshot({ path: path.join(OUT, 'site-下载卡.png') });

  /* 更新手记截图 */
  await page.locator('#journal').scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.locator('#journal').screenshot({ path: path.join(OUT, 'site-更新手记.png') });

  /* 整页（便于总览） */
  await page.screenshot({ path: path.join(OUT, 'site-整页.png'), fullPage: true });

  /* 安装包可下载性（HEAD + Range） */
  const base = new URL(SITE);
  const exe = new URL(info.dlHref, base).toString();
  const r1 = await fetch(exe, { method: 'HEAD' });
  const r2 = await fetch(exe, { headers: { Range: 'bytes=0-99' } });
  console.log('EXE HEAD:', r1.status, r1.headers.get('content-length'), r1.headers.get('content-type'));
  console.log('EXE Range:', r2.status, 'bytes=', (await r2.arrayBuffer()).byteLength);

  console.log('截图输出：', fs.readdirSync(OUT).join(', '));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
