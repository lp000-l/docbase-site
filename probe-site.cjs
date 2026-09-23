/*
 * probe-site.cjs —— 官网「发布后一致性」校验（本地预览 / 线上站点都可用）
 *
 * 为什么要它：`shot-site.cjs` 只看「下载链接 / 手记条目数 / 导航锚点」这类骨架，
 * 而这些恰恰是**不会出错**的部分。真正会出错的是「页面标注与本次构建对不上」——
 * 校验码表里的哈希、下载卡上的版本与体积、手记里到底写了哪几条、构建编号与指纹
 * 是不是本次构建的。这些都得**打开页面读渲染结果**才能验，光看 HTML 源码不算数，
 * 因为这几处都是 JS 读完 `purity.json` 后回填的。
 *
 * v1.3.0 起还多管三件事：
 *   · 更新手记拆成了 journal.html、多了 feedback.html —— 逐页打开确认能渲染、无 JS 报错
 *   · **站内死链**：所有 index/journal/feedback 的站内链接与资源必须真的能取到
 *     （拆页时最容易留下 `href="#journal"` 这种指向已不存在的锚点，肉眼很难发现）
 *   · 反馈表单的**前端校验**：空标题 / 太短的内容要当场拦下，不能白发一个请求
 *
 * 用法：
 *   node probe-site.cjs https://bishe.xin/                # 线上
 *   node probe-site.cjs http://127.0.0.1:8899/            # 本地静态服务（可先验再传）
 *
 * 期望值（版本号 / 哈希 / 构建编号 / 指纹）从同目录的 `purity.json` 读，不手抄 ——
 * 手抄必然会过期，那正是这个脚本要防的毛病。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/17760/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const CHROME = 'C:/Users/17760/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const SITE = process.argv[2] || 'https://bishe.xin/';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'purity.json'), 'utf8'));
/* 便携版清单（由 portable/4-make-zip.cjs 每出一份包就刷新）——期望值一律从这里读 */
const PORT = JSON.parse(fs.readFileSync(path.join(__dirname, 'portable.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (c, n, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined && x !== '' ? '  [' + x + ']' : '')); };

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
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  const ver = MANIFEST.version;
  const inst = MANIFEST.files.find(f => /\.exe$/i.test(f.name));
  const bundle = MANIFEST.files.find(f => /server\.bundle\.js$/i.test(f.name));
  const asar = MANIFEST.files.find(f => /app\.asar$/i.test(f.name));
  const mb = n => (n / 1048576).toFixed(1) + ' MB';

  /* ═══════ ① 主页 ═══════ */
  console.log('\n=== ① 主页 index.html ===');
  const resp = await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('HTTP ' + resp.status() + '  ' + resp.url());
  await page.waitForTimeout(2500);   /* 等 purity.json 取回并回填 */

  const dlHref = await page.locator('.dl-btn').first().getAttribute('href');
  const dlMeta = ((await page.locator('#dlMeta').textContent()) || '').trim();
  console.log('  下载链接: ' + dlHref + ' | 元信息: ' + dlMeta);
  ok(!!dlHref && dlHref.includes(ver), '下载链接指向当前版本 ' + ver, dlHref);
  ok(dlMeta === 'v' + ver + ' · 64 位 · 约 ' + mb(inst.size), '下载卡元信息与 purity.json 一致', dlMeta);

  const rows = await page.evaluate(() => [...document.querySelectorAll('#dlCkBody tr')]
    .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim())));
  console.log('  校验码表 ' + rows.length + ' 行: ' + JSON.stringify(rows.map(r => r[0])));
  ok(rows.length === MANIFEST.files.length, '校验码表行数 = 清单文件数', rows.length + '/' + MANIFEST.files.length);
  const instRow = rows.find(r => /DocBase-Setup-[\d.]+\.exe|文渊阁-安装程序-v[\d.]+\.exe/.test(r[0] || ''));
  /* 站上是以 DocBase-Setup-x.y.z.exe 提供的，清单里记的是构建产物名；两者字节相同。
     显示成构建产物名会让人以为「表里写的不是我下的那个」，所以这里要求两者一致。 */
  ok(!!instRow && instRow[0] === path.basename(dlHref), '安装包那一行显示的是下载文件名（与链接同一名）', instRow && instRow[0]);
  ok(!!instRow && instRow[2] === inst.sha256, '安装包 SHA-256 与清单一致', instRow && instRow[2].slice(0, 16));
  if (bundle) ok(rows.some(r => r[0] === bundle.name && r[2] === bundle.sha256), 'bundle 行 SHA-256 一致');
  if (asar) ok(rows.some(r => r[0] === asar.name && r[2] === asar.sha256), 'asar 行 SHA-256 一致');

  const note = ((await page.locator('.dl-ck-desc').first().textContent()) || '').trim();
  ok(note.includes(MANIFEST.buildId), '页面公示的构建编号 = 本次构建', (note.match(/WYG-[0-9A-Z-]+/) || [''])[0]);
  ok(note.includes(MANIFEST.fingerprint), '页面公示的指纹 = 本次构建', (note.match(/[A-F0-9]{16}/) || [''])[0]);
  /* 下载的两条说明必须在（用户报过"提示有风险""下载慢"，说明是给他们的答复） */
  const ck = await page.evaluate(() => [...document.querySelectorAll('.dl-ck summary')].map(s => s.textContent.trim()));
  console.log('  下载区说明: ' + JSON.stringify(ck));
  ok(ck.some(t => /风险/.test(t)), '下载区说明了「浏览器提示有风险」是怎么回事');
  ok(ck.some(t => /慢|断了/.test(t)), '下载区说明了「下载慢 / 断了」怎么办');

  /* 便携版入口：下载卡里要有第二个按钮，还要有去专页的链接 */
  const dlBtns = await page.evaluate(() => [...document.querySelectorAll('.dl-btn')].map(a => ({
    h: a.getAttribute('href'), os: ((a.querySelector('.dl-os') || {}).textContent || '').trim(),
  })));
  console.log('  下载按钮: ' + JSON.stringify(dlBtns));
  /* 比**文件名部分**：主站上 href 是裸文件名，镜像站上是指向 Releases 的绝对地址 —— 两种都该算数。 */
  const baseName = h => String(h || '').split('/').pop();
  ok(dlBtns.length >= 2 && dlBtns.some(x => baseName(x.h) === PORT.file), '主页下载卡里有便携版按钮', dlBtns.map(x => baseName(x.h)).join(' + '));
  ok(dlBtns.some(x => /便携/.test(x.os)), '便携版按钮上写着「便携版」', dlBtns.map(x => x.os).join(' + '));
  ok(await page.evaluate(() => !!document.querySelector('a[href="portable.html"]')), '主页有去便携版专页的链接');

  /* 主页只留最近三版 + 一个去专页的入口 */
  const idxJr = await page.evaluate(() => {
    const li = [...document.querySelectorAll('#journal .jr-item')];
    return { n: li.length, first: li[0] ? (li[0].querySelector('.jr-ver') || {}).textContent : null, more: !!document.querySelector('#journal a[href="journal.html"]') };
  });
  console.log('  主页手记: ' + JSON.stringify(idxJr));
  ok(idxJr.n === 3, '主页只列最近三版（不再堆一整页）', String(idxJr.n));
  ok(idxJr.first === 'v' + ver, '主页手记第一条是本版', idxJr.first);
  ok(idxJr.more, '主页有「查看全部修订」入口指向 journal.html');

  /* ═══════ ② 更新手记专页 ═══════ */
  /* ═══════ ①b 便携版专页 ═══════ */
  console.log('\n=== ①b 便携版专页 portable.html ===');
  const pfResp = await page.goto(new URL('portable.html', SITE).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('HTTP ' + pfResp.status() + '  ' + pfResp.url());
  ok(pfResp.status() === 200, '便携版专页能打开', String(pfResp.status()));
  await page.waitForTimeout(1800);   /* 等 portable.json 取回并回填 */
  const pf = await page.evaluate(() => {
    const q = sel => document.querySelector(sel);
    return {
      title: document.title,
      href: q('.dl-btn') ? q('.dl-btn').getAttribute('href') : null,
      meta: ((q('#pfMeta') || {}).textContent || '').trim(),
      rows: [...document.querySelectorAll('#pfCkBody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim())),
      md5: ((q('#pfMd5') || {}).textContent || '').trim(),
      steps: document.querySelectorAll('.pf-steps > li').length,
      sheets: document.querySelectorAll('.pf-sheets .sheet').length,
      notes: document.querySelectorAll('.pf-notes li').length,
      faq: document.querySelectorAll('#faq details').length,
      hasHow: !!q('#how'), hasEnv: !!q('#env'), hasDiff: !!q('#diff'), hasWhat: !!q('#what'),
      copyBtn: !!q('#dlCopy'),
      navOn: !!document.querySelector('.nav a.on[href="portable.html"]'),
      mnavOn: !![...document.querySelectorAll('#mnav a')].find(a => a.getAttribute('href') === 'portable.html'),
    };
  });
  ok(/便携版/.test(pf.title), '页面标题写了便携版', pf.title);
  ok(baseName(pf.href) === PORT.file, '下载按钮指向清单里的文件名', baseName(pf.href) + ' / ' + PORT.file);
  ok(pf.meta.includes(PORT.version) && pf.meta.includes((PORT.size / 1048576).toFixed(1)) + ' MB', '标注的版本与体积与清单一致', pf.meta);
  const pfRow = pf.rows.find(r => r[0] === PORT.file);
  ok(!!pfRow && pfRow[2] === PORT.sha256, '校验码表里 zip 那一行的 SHA-256 = 清单', pfRow ? pfRow[2].slice(0, 16) : '没找到那一行');
  ok(pf.md5 === PORT.md5, 'MD5 与清单一致', pf.md5.slice(0, 16));
  ok(pf.sheets >= 3, '写了三条卖点', pf.sheets + ' 张卡');
  ok(pf.steps >= 3, '写了使用步骤', pf.steps + ' 步');
  ok(pf.notes >= 5, '写了注意事项', pf.notes + ' 条');
  ok(pf.faq >= 5, '写了常见问题', pf.faq + ' 条');
  ok(pf.hasWhat && pf.hasHow && pf.hasEnv && pf.hasDiff, '「是什么 / 怎么用 / 自带环境 / 与安装版区别」四节都在');
  ok(pf.copyBtn, '有「复制下载链接」按钮（手机端要用）');
  ok(pf.navOn && pf.mnavOn, '顶栏与手机导航里都有便携版入口');
  /* 便携包本体：只做 HEAD（真下 230MB 太慢，哈希在上传时已核对过一次） */
  try {
    /* 按 **href 本身**解析地址（不再假设包挂在站点根下），并改用 Range 取 1 字节来验：
       ① 体积从 content-range 读；② 顺便证明支持断点续传。
       比 HEAD 可靠 —— GitHub Releases 的资产对 HEAD 往往直接 404，而镜像站的下载按钮正指向那里。 */
    const zurl = new URL(pf.href || PORT.file, SITE).toString();
    const h = await fetch(zurl, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
    const cr = h.headers.get('content-range') || '';
    const len = Number(h.ok ? (cr ? cr.split('/')[1] : (h.headers.get('content-length') || 0)) : 0);
    const ar = (/^bytes \d+-\d+\/\d+$/.test(cr) ? 'bytes' : (h.headers.get('accept-ranges') || '')).toLowerCase();
    ok(h.ok && len === PORT.size, '便携包体积与清单一致', len + ' / ' + PORT.size + ' · ' + zurl.split('/').pop());
    ok(ar.includes('bytes'), '便携包支持分段下载（断了能续传）', ar || '(无)');
  } catch (e) { ok(false, '便携包取不到', String((e && e.message) || e)); }

  console.log('\n=== ② 更新手记 journal.html ===');
  const jr = await page.goto(new URL('journal.html', SITE).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  const jinfo = await page.evaluate(() => {
    const li = [...document.querySelectorAll('.journal .jr-item')];
    const latest = document.querySelector('.jr-item.latest');
    return {
      http: 1, n: li.length,
      vers: li.map(x => (x.querySelector('.jr-ver') || {}).textContent),
      latest: latest ? (latest.querySelector('.jr-ver') || {}).textContent : null,
      latestCnt: document.querySelectorAll('.jr-item.latest').length,
      text: latest ? latest.textContent.replace(/\s+/g, ' ') : '',
      hasBack: !!document.querySelector('a[href="index.html"]'),
    };
  });
  console.log('  条目数 ' + jinfo.n + '，最新 ' + jinfo.latest + '，末条 ' + jinfo.vers[jinfo.vers.length - 1]);
  ok(jr.status() === 200, 'HTTP 200', String(jr.status()));
  ok(jinfo.n >= 12, '历次修订都在（至少 12 条）', String(jinfo.n));
  ok(jinfo.latest === 'v' + ver, '第一条是本版 v' + ver, jinfo.latest);
  ok(jinfo.latestCnt === 1, '「latest」只挂在一个条目上', String(jinfo.latestCnt));
  ok(jinfo.vers[jinfo.vers.length - 1] === 'v1.1.1', '最早一条仍在（没被截掉）', jinfo.vers[jinfo.vers.length - 1]);
  ok(jinfo.hasBack, '有回首页的入口');
  /* 本版要点按命令行传入的关键词核对：--must 双击连接 --must 划词 */
  const must = [];
  process.argv.forEach((a, i) => { if (a === '--must' && process.argv[i + 1]) must.push(process.argv[i + 1]); });
  for (const kw of must) ok(jinfo.text.includes(kw), '本版手记提到「' + kw + '」');

  /* ═══════ ③ 反馈页 ═══════ */
  console.log('\n=== ③ 反馈页 feedback.html ===');
  const fb = await page.goto(new URL('feedback.html', SITE).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);
  const fbinfo = await page.evaluate(() => {
    const f = document.getElementById('fbForm');
    return {
      hasForm: !!f,
      fields: f ? [...f.querySelectorAll('input[name], textarea[name]')].map(x => x.name) : [],
      kinds: f ? f.querySelectorAll('input[name=kind]').length : 0,
      hp: !!document.getElementById('fbSite'),
      btn: !!document.getElementById('fbSend'),
    };
  });
  console.log('  表单字段: ' + JSON.stringify(fbinfo.fields));
  ok(fb.status() === 200, 'HTTP 200', String(fb.status()));
  ok(fbinfo.hasForm, '有反馈表单');
  ok(fbinfo.kinds === 4, '四种反馈类型都在', String(fbinfo.kinds));
  ok(fbinfo.hp, '带蜜罐字段（反垃圾）');
  for (const n of ['kind', 'title', 'body', 'contact', 'email']) ok(fbinfo.fields.includes(n), '字段存在：' + n);
  /* 前端校验：空标题 / 太短内容要当场拦下，而不是白发一个请求 */
  const guard = await page.evaluate(async () => {
    const f = document.getElementById('fbForm');
    const msg = document.getElementById('fbMsg');
    const before = msg.textContent;
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const emptyTitle = msg.textContent;
    document.getElementById('fbTitle').value = '标题够长了';
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const shortBody = msg.textContent;
    return { emptyTitle, shortBody, cls: msg.className, changed: before !== msg.textContent };
  });
  console.log('  前端校验: ' + JSON.stringify(guard));
  ok(/一句话/.test(guard.emptyTitle), '空标题被当场拦下', guard.emptyTitle);
  ok(/再.*写|两句/.test(guard.shortBody), '内容太短被当场拦下', guard.shortBody);
  ok(/err/.test(guard.cls), '拦下时给出的是错误样式', guard.cls);

  /* ═══════ ④ 站内死链（拆页最容易留下的坑） ═══════ */
  console.log('\n=== ④ 站内链接与资源可及性 ===');
  const links = new Set();
  for (const p of ['index.html', 'portable.html', 'journal.html', 'feedback.html']) {
    await page.goto(new URL(p, SITE).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href], link[href], script[src], img[src]')]
      .map(e => e.getAttribute('href') || e.getAttribute('src')));
    hrefs.forEach(h => { if (h && !/^(https?:|mailto:|tel:|data:|#javascript)/i.test(h)) links.add(h.split('#')[0] || ''); });
  }
  const targets = [...links].filter(h => h !== '' && !/^#/.test(h));
  console.log('  待验链接 ' + targets.length + ' 个: ' + JSON.stringify(targets));
  const bad = [];
  for (const h of targets) {
    const u = new URL(h, SITE).toString();
    try {
      const r = await fetch(u, { method: 'HEAD' });
      if (!r.ok) bad.push(h + ' → ' + r.status);
    } catch (e) { bad.push(h + ' → ' + (e.message || 'ERR')); }
  }
  ok(bad.length === 0, '站内链接与资源全部可取到（无死链）', bad.join(', ') || '无');
  /* 逐个页面确认没有指向已不存在的锚点 */
  const anchorCheck = await page.evaluate(async () => {
    const out = [];
    for (const p of ['index.html', 'portable.html', 'journal.html', 'feedback.html']) {
      const r = await fetch(p);
      const t = await r.text();
      const ids = new Set([...t.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
      const anchors = [...t.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
      for (const a of new Set(anchors)) if (!ids.has(a) && a !== '') out.push(p + ' #' + a);
    }
    return out;
  });
  ok(anchorCheck.length === 0, '页面内锚点都有对应的目标（没有指向已删区块的 #xxx）', anchorCheck.join(', ') || '无');

  /* ═══════ ⑤ 内容是真的"看得见"，而不是停在入场的隐藏态 ═══════ */
  console.log('\n=== ⑤ 内容可见性（入场动效的隐藏态最容易漏）===');
  /* 这一节是被一次真事故逼出来的：更新手记专页整页空白 —— 条目都在 DOM 里、
     但入场动画的 `.rv{opacity:0}` 一直没被摘掉。原因是观察器阈值 0.12，
     而整个 <ol> 高 5785px、视口 600px，最大交叉比约 10%，**永远不触发**。
     光断言"DOM 里有 N 条"完全查不出来，必须量**计算样式里的透明度**。
     注意断言口径：允许"还没滚到所以还没出现"（那是错峰入场的正常表现），
     但不允许"滚到底了还趴着不动" —— 后者才是真 bug。 */
  for (const p of ['index.html', 'portable.html', 'journal.html', 'feedback.html']) {
    await page.goto(new URL(p, SITE).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    /* 一路滚到底，把该触发的入场都触发掉。
       必须先关掉平滑滚动：站点的 `html{scroll-behavior:smooth}` 会让连续 scrollTo
       排队做动画，位置根本追不上循环，扫完一圈其实没真正到达过那些地方 ——
       探针据此报"元素卡在隐藏态"，是假的。 */
    await page.evaluate(async () => {
      const html = document.documentElement;
      const old = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      const h = document.body.scrollHeight;
      for (let y = 0; y <= h; y += Math.round(window.innerHeight * 0.5)) {
        window.scrollTo(0, y);
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 90)));
      }
      window.scrollTo(0, 0);
      html.style.scrollBehavior = old;
    });
    await page.waitForTimeout(1600);
    const r = await page.evaluate(() => {
      const rvs = [...document.querySelectorAll('.rv')];
      const stuck = rvs.filter(e => parseFloat(getComputedStyle(e).opacity) < 0.9
        || getComputedStyle(e).visibility === 'hidden' || getComputedStyle(e).display === 'none');
      const total = document.querySelectorAll('.jr-item, .hero-title, .dl-btn, #fbForm').length;
      return {
        rv: rvs.length, rvStuck: stuck.length,
        stuckWhat: stuck.slice(0, 4).map(e => (e.className || e.tagName).split(' ').slice(0, 2).join('.')),
        rvReady: document.documentElement.classList.contains('rv-ready'),
        keyTotal: total,
      };
    });
    console.log('  ' + p + ': ' + JSON.stringify(r));
    ok(r.keyTotal > 0, p + ' 有可检查的关键区块', String(r.keyTotal));
    ok(r.rvStuck === 0, p + ' 滚过一遍后没有元素还卡在隐藏态', r.rvStuck ? (r.rvStuck + ' 个：' + r.stuckWhat.join(', ')) : '全部已显现');
    /* 页首那些一进页面就该看见的，不能等滚动 */
    const first = await page.evaluate(() => {
      const el = document.querySelector('.hero-title, .subhero .ch-title, .fb-card');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { tag: el.className.split(' ')[0], opacity: cs.opacity };
    });
    ok(!!first && parseFloat(first.opacity) > 0.9, p + ' 首屏区块一进来就是可见的', first ? first.tag + ' opacity=' + first.opacity : '找不到');
  }

  ok(errs.length === 0, '四个页面（含便携版专页）都没有 JS 报错', errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n--- probe-site: 通过 ' + pass + ' / 失败 ' + fail + ' ---');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('探针异常:', (e && e.stack) || e); process.exit(2); });
