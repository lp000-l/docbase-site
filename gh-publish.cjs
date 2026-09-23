/*
 * gh-publish.cjs —— 把官网发布到 GitHub：Pages 镜像 + Releases 资产
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 用途：给 https://bishe.xin 做一个 GitHub 上的备用入口 ——
 *   ① 静态站 → GitHub Pages（主页/手记/便携版专页/反馈页）
 *   ② 安装包与便携包 → 本仓库的 Releases（镜像站自己就能下载，不依赖主站还活着）
 *
 * 用法（在 docbase-website/ 目录里）：
 *   GITHUB_TOKEN=xxx node gh-publish.cjs                 # 完整发布
 *   GITHUB_TOKEN=xxx node gh-publish.cjs --no-release    # 只更新 Pages，不动 Releases
 *   node gh-publish.cjs --dry                            # 只组装出 dist-gh/ 给你看，不联网
 *   node gh-publish.cjs --dl=main                        # 下载按钮指向 bishe.xin（默认指向 GitHub Releases）
 *
 * 约定（都是踩过的坑，别改）：
 *   · **token 只从环境变量读**，不写进任何文件、不写进 .git/config（push 时用一次性 URL），
 *     出错信息里也会把 token 抹成 *** 再打印。
 *   · **幂等**：仓库/Pages/Release/资产都存在就跳过，可以反复跑。
 *   · **不碰你的全局 git 配置**：全部用 `git -c ...` 传参。
 *   · 本站是**生成物**，推送用 `--force`（远端只应该是这份生成的静态站）。
 */
'use strict';
/* ⚠️ 本构建机的沙箱代理会替换 TLS 证书 —— 不放宽就是清一色
   \`fetch failed: unable to verify the first certificate\`（GitHub 全站如此，实测四个域名全中）。
   只在沙箱里需要；正常网络下带 WYG_STRICT_TLS=1 跑即可（那时会走严格校验）。 */
if (process.env.WYG_STRICT_TLS !== '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

/* ── 路径与版本 ─────────────────────────────────────────────────────────── */
const HERE = __dirname;
const APP = path.join(HERE, '..', 'docbase-app');
const DIST = path.join(HERE, 'dist-gh');
const TEMPLATES = path.join(HERE, 'gh-site-files');
const RELEASE_DIR = path.join(APP, 'dist-release');
const GIT = process.env.GIT_BIN || 'C:/Users/17760/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe';
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const MAIN_SITE = 'https://bishe.xin/';

/* ── 参数 ──────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const has = k => argv.includes(k);
const opt = (k, d) => { const m = argv.find(a => a.startsWith(k + '=')); return m ? m.slice(k.length + 1) : d; };
const DRY = has('--dry');
const WITH_RELEASE = !has('--no-release');
const DL_FROM = opt('--dl', 'github');       /* github | main */
const REPO = opt('--repo', 'docbase-site');
const TOKEN = process.env.GITHUB_TOKEN || '';

const mask = s => String(s == null ? '' : s).split(TOKEN || '\u0000').join('***');
const say = (...a) => console.log(...a.map(mask));
const die = m => { console.error(mask('✗ ' + m)); process.exit(1); };

/* ── 小工具 ────────────────────────────────────────────────────────────── */
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const size = f => fs.statSync(f).size;
const kb = n => (n / 1048576).toFixed(2) + ' MB';

const run = (exe, args, o) => new Promise(res => {
  const p = spawn(exe, args, Object.assign({ windowsHide: true, cwd: HERE }, o || {}));
  let out = '', err = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => err += d);
  p.on('error', e => res({ code: -1, out, err: String(e.message) }));
  p.on('close', c => res({ code: c, out, err }));
});
const GIT_ARGS = ['-c', 'user.name=docbase-publish', '-c', 'user.email=2957296913@qq.com',
  '-c', 'credential.helper=', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main']
  /* git 走 HTTPS 也会撞上同一个证书问题（报 "SSL certificate problem"），一起放宽。 */
  .concat(process.env.WYG_STRICT_TLS === '1' ? [] : ['-c', 'http.sslVerify=false']);
const git = (args, o) => run(GIT, GIT_ARGS.concat(args), o);

async function api(method, url, body, raw) {
  const headers = {
    'Authorization': 'Bearer ' + TOKEN,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'docbase-publish',
  };
  let payload;
  if (body instanceof Buffer || typeof body === 'string') { payload = body; headers['Content-Type'] = raw || 'application/octet-stream'; }
  else if (body) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, { method, headers, body: payload });
  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch (e) { }
  return { status: r.status, json, text: txt, headers: r.headers };
}

/* ═══════════════════════════ ① 组装静态站 ═══════════════════════════════ */
function buildSite(owner) {
  const purity = JSON.parse(fs.readFileSync(path.join(HERE, 'purity.json'), 'utf8'));
  const VER = purity.version;
  const TAG = 'v' + VER;
  const PAGES_URL = owner ? `https://${owner}.github.io/${REPO}/` : `https://<owner>.github.io/${REPO}/`;
  const RELEASES_URL = owner ? `https://github.com/${owner}/${REPO}/releases` : `https://github.com/<owner>/${REPO}/releases`;

  const files = ['index.html', 'journal.html', 'feedback.html', 'portable.html', 'site.css', 'site.js',
    'purity.json', 'portable.json', 'updates.json'];
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const copier = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); };
  let patched = { dl: 0, fb: 0, foot: 0 };

  for (const f of files) {
    const src = path.join(HERE, f);
    if (!fs.existsSync(src)) die('源文件缺失：' + f);
    let s = fs.readFileSync(src, 'utf8');
    if (f.endsWith('.html')) {
      /* ① 下载按钮：镜像上指向本仓库的 Releases（默认），或指回主站 */
      s = s.replace(/href="(DocBase-(?:Setup|Portable)-[\d.]+\.(?:exe|zip))"/g, (m, name) => {
        patched.dl++;
        return DL_FROM === 'main'
          ? `href="${MAIN_SITE}${name}"`
          : `href="https://github.com/${owner}/${REPO}/releases/download/${TAG}/${name}"`;
      });
      /* ② 反馈表单：Pages 上没有 PHP，指到正式站点的接口（PHP 那边已放行镜像来源的跨域请求） */
      const before = s;
      s = s.split("fetch('api/feedback.php'").join(`fetch('${MAIN_SITE}api/feedback.php'`);
      if (s !== before) patched.fb++;
      /* ③ 页脚加一行"这是镜像站"，别让访客以为镜像才是正式站 */
      if (s.includes('</footer>')) {
        s = s.replace('</footer>', `  <p class="gh-mirror">本站为 GitHub Pages 镜像站，内容与正式站点同源。正式站点：<a href="${MAIN_SITE}">bishe.xin</a></p>\n  </footer>`);
        patched.foot++;
      }
      /* ④ 告诉搜索引擎别把镜像当主站 */
      s = s.replace(/<title>([^<]*)<\/title>/, (m, t) => `<title>${t}</title>\n  <meta name="mirror-of" content="${MAIN_SITE}">`);
    }
    if (f === 'site.css') s += MIRROR_CSS;
    fs.writeFileSync(path.join(DIST, f), s);
  }

  /* 仓库说明与 Pages 需要的两件小事 */
  let readme = fs.readFileSync(path.join(TEMPLATES, 'README.md'), 'utf8');
  const today = new Date();
  const zh = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const dateCn = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日`;
  readme = readme.split('{{VERSION}}').join(VER).split('{{UPDATED}}').join(dateCn)
    .split('{{PAGES_URL}}').join(PAGES_URL).split('{{RELEASES_URL}}').join(RELEASES_URL);
  fs.writeFileSync(path.join(DIST, 'README.md'), readme);
  copier(path.join(TEMPLATES, '.nojekyll'), path.join(DIST, '.nojekyll'));
  copier(path.join(TEMPLATES, '.gitignore'), path.join(DIST, '.gitignore'));

  /* 要上传的两个包（改名前先在本地核一遍哈希，Release 说明里要写） */
  const assets = [];
  const inst = path.join(RELEASE_DIR, `文渊阁-安装程序-v${VER}.exe`);
  const port = path.join(RELEASE_DIR, `文渊阁便携版-v${VER}.zip`);
  if (fs.existsSync(inst)) assets.push({ local: inst, name: `DocBase-Setup-${VER}.exe`, sha: sha256(inst) });
  if (fs.existsSync(port)) assets.push({ local: port, name: `DocBase-Portable-${VER}.zip`, sha: sha256(port) });

  return { VER, TAG, PAGES_URL, RELEASES_URL, assets, patched, dateCn };
}

const MIRROR_CSS = `
/* ═══ GitHub Pages 镜像站：页脚那一行提示 ═══ */
.gh-mirror {
  max-width: var(--wrap, 1120px); margin: 18px auto 0; padding: 10px 16px;
  font-size: 13px; line-height: 1.7; color: var(--ink-3, #6b6b6b);
  border-top: 1px dashed var(--rule, rgba(0,0,0,.14)); text-align: center;
}
.gh-mirror a { color: var(--cinnabar, #a8322a); border-bottom: 1px solid rgba(168,50,42,.35); }
`;

/* ═══════════════════════ ② 推送静态站（git push） ═══════════════════════ */
async function pushSite(owner) {
  const gitdir = path.join(DIST, '.git');
  if (!fs.existsSync(gitdir)) {
    let r = await git(['init', '-q']);
    if (r.code !== 0) die('git init 失败：' + (r.err || r.out));
  }
  let r = await git(['add', '-A']);
  if (r.code !== 0) die('git add 失败：' + (r.err || r.out));
  r = await git(['checkout', '-B', 'main', '-q']);
  if (r.code !== 0) { r = await git(['symbolic-ref', 'HEAD', 'refs/heads/main']); }
  const st = await git(['status', '--porcelain']);
  const changed = (st.out || '').trim().length > 0;
  if (changed) {
    r = await git(['commit', '-q', '-m', `发布 v${build.VER}（${build.dateCn}）`]);
    if (r.code !== 0) die('git commit 失败：' + (r.err || r.out));
    say('  ✓ 已提交本地改动');
  } else say('  · 内容无变化（仍会重新推一遍，保证远端一致）');

  const url = `https://x-access-token:${TOKEN}@github.com/${owner}/${REPO}.git`;
  r = await git(['push', '--force', url, 'main:main']);
  if (r.code !== 0) {
    const e = (r.err || '') + (r.out || '');
    if (/Authentication failed|Invalid username or password|could not read Username|403/i.test(e)) {
      die('推送被拒 —— token 不对、或权限不够（需要 repo 权限，若是细粒度 token 请勾 Contents: Read and write）。\n' + e.slice(-400));
    }
    die('git push 失败：' + e.slice(-600));
  }
  say('  ✓ 静态站已推送到 ' + owner + '/' + REPO + ' (main)');
}

/* ═══════════════════════ ③ 开 Pages（幂等） ═══════════════════════════ */
async function ensurePages(owner) {
  const base = `${API}/repos/${owner}/${REPO}`;
  let r = await api('GET', base + '/pages');
  if (r.status === 200) {
    const cur = r.json && r.json.source;
    if (cur && cur.branch === 'main' && (cur.path || '/') === '/') { say('  · Pages 已开启（main / 根目录）'); return; }
    r = await api('PUT', base + '/pages', { source: { branch: 'main', path: '/' } });
    say(r.status < 300 ? '  ✓ Pages 源已改到 main / 根目录' : '  ⚠️ 改 Pages 源失败：HTTP ' + r.status + ' ' + r.text.slice(0, 200));
    return;
  }
  if (r.status !== 404) { say('  ⚠️ 查 Pages 状态异常 HTTP ' + r.status + '（继续尝试开启）'); }
  r = await api('POST', base + '/pages', { source: { branch: 'main', path: '/' } });
  if (r.status < 300) say('  ✓ Pages 已开启（main / 根目录）');
  else if (r.status === 409) say('  · Pages 本来就开着（409）');
  else say('  ⚠️ 开 Pages 失败：HTTP ' + r.status + ' ' + r.text.slice(0, 240));
}

/* ═══════════════════ ④ 建 Release 并上传两个包 ═══════════════════ */
async function ensureRelease(owner, bp) {
  const base = `${API}/repos/${owner}/${REPO}`;
  const updates = JSON.parse(fs.readFileSync(path.join(HERE, 'updates.json'), 'utf8'));
  const notes = (updates.version === bp.VER && Array.isArray(updates.notes)) ? updates.notes : [];
  const body = [
    `文渊阁 DocBase v${bp.VER} —— Windows 单机知识库（文档 / 表格 / PPT / PDF / 图片统一管理，可运行代码，支持 .ipynb 笔记本）。`,
    '',
    '## 下载',
    ...bp.assets.map(a => `- **${a.name}**（${kb(size(a.local))}）\n  \`sha256 ${a.sha}\``),
    '',
    '安装版会自动检查更新；便携版解压即用、自带 Python、资料跟着 U 盘走（不参与自动更新）。',
    '',
    '## 本版更新',
    ...notes.map(n => '- ' + n),
    '',
    `正式站点：${MAIN_SITE} · 官网镜像：${bp.PAGES_URL}`,
  ].join('\n');

  let r = await api('GET', base + '/releases/tags/' + bp.TAG);
  let rel;
  if (r.status === 200) {
    rel = r.json;
    say('  · Release ' + bp.TAG + ' 已存在，更新说明');
    r = await api('PATCH', base + '/releases/' + rel.id, { name: 'v' + bp.VER, body });
    if (r.status < 300) rel = r.json;
  } else {
    r = await api('POST', base + '/releases', {
      tag_name: bp.TAG, name: 'v' + bp.VER, body, draft: false, prerelease: false,
    });
    if (r.status >= 300) die('建 Release 失败：HTTP ' + r.status + ' ' + r.text.slice(0, 300));
    rel = r.json;
    say('  ✓ Release ' + bp.TAG + ' 已建');
  }

  /* 资产：同名同大小就跳过（幂等） */
  const list = await api('GET', base + '/releases/' + rel.id + '/assets?per_page=100');
  const have = new Map(((list.json || [])).map(a => [a.name, a.size]));
  for (const a of bp.assets) {
    const sz = size(a.local);
    if (have.get(a.name) === sz) { say('  · ' + a.name + ' 已在（' + kb(sz) + '），跳过'); continue; }
    say('  ⇪ 上传 ' + a.name + '（' + kb(sz) + '）…… 大文件要几分钟，别打断');
    const t0 = Date.now();
    const up = await fetch(`${UPLOADS}/repos/${owner}/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(a.name)}`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(sz),
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'docbase-publish',
      },
      body: fs.readFileSync(a.local),
    });
    const txt = await up.text();
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    if (up.status >= 300) die('上传 ' + a.name + ' 失败：HTTP ' + up.status + ' ' + txt.slice(0, 300));
    say('  ✓ ' + a.name + ' 上传完成，用时 ' + sec + 's');
  }
}

/* ═══════════════════════════ 主流程 ═══════════════════════════ */
let build;
(async () => {
  if (!DRY && !TOKEN) {
    die('没有 GITHUB_TOKEN。用法：GITHUB_TOKEN=xxx node gh-publish.cjs\n'
      + '（token 只从环境变量读，我不会把它写进任何文件。生成路径：GitHub → Settings → Developer settings\n'
      + ' → Personal access tokens → Fine-grained tokens → 勾 repo 全部 + workflow，或经典 token 勾 repo。）');
  }

  console.log('══ 文渊阁官网 → GitHub 发布 ══\n');
  /* 先确定 owner（= 这个 token 属于谁），打包脚本要用它拼链接 */
  let owner = opt('--owner', '');
  if (!owner && !DRY) {
    const me = await api('GET', API + '/user');
    if (me.status !== 200) die('token 无效或权限不足：HTTP ' + me.status + ' ' + (me.json && me.json.message || me.text.slice(0, 120)));
    owner = me.json.login;
  }
  if (!owner) owner = 'OWNER';

  console.log('① 组装静态站');
  build = buildSite(owner);
  console.log('  版本 v' + build.VER + ' · 目标仓库 ' + owner + '/' + REPO + ' · 下载指向 ' + DL_FROM);
  console.log('  补丁：下载按钮 ' + build.patched.dl + ' 处、反馈接口 ' + build.patched.fb + ' 处、页脚镜像提示 ' + build.patched.foot + ' 处');
  const inDist = fs.readdirSync(DIST);
  console.log('  dist-gh/ 共 ' + inDist.length + ' 项：' + inDist.join(' '));
  for (const a of build.assets) console.log('  待发资产 ' + a.name + '  ' + kb(size(a.local)) + '  sha256 ' + a.sha.slice(0, 16) + '…');
  if (build.patched.dl === 0) die('下载按钮一处都没替换到 —— 页面结构变了？先核对 index.html/portable.html 的 <a href="DocBase-...">');

  if (DRY) { console.log('\n（--dry：只组装，不联网。dist-gh/ 已生成，自己看看。）'); return; }

  console.log('\n② 仓库');
  let r = await api('GET', `${API}/repos/${owner}/${REPO}`);
  if (r.status === 200) console.log('  · 仓库已存在');
  else {
    r = await api('POST', API + '/user/repos', {
      name: REPO, private: false, has_issues: true, has_wiki: false,
      description: '文渊阁 DocBase 官网镜像（GitHub Pages）+ 安装包 / 便携包下载（Releases）',
    });
    if (r.status >= 300) die('建仓库失败：HTTP ' + r.status + ' ' + r.text.slice(0, 300));
    console.log('  ✓ 仓库已建：https://github.com/' + owner + '/' + REPO);
  }

  console.log('\n③ 推送静态站');
  await pushSite(owner);

  console.log('\n④ 开启 GitHub Pages');
  await ensurePages(owner);

  if (WITH_RELEASE) {
    console.log('\n⑤ Release 与资产');
    await ensureRelease(owner, build);
  } else console.log('\n⑤ 跳过 Release（--no-release）');

  console.log('\n══ 完成 ══');
  console.log('  镜像站：' + build.PAGES_URL + '  （首次开启 Pages 约 1 分钟生效）');
  console.log('  仓库：  https://github.com/' + owner + '/' + REPO);
  console.log('  Releases：' + build.RELEASES_URL);
  console.log('\n下一步（建议）：node probe-mirror.cjs ' + build.PAGES_URL + '   —— 逐项核对镜像站内容');
})().catch(e => die(String(e && e.stack || e)));
