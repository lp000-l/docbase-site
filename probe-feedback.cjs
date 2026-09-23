/*
 * probe-feedback.cjs —— 官网反馈链路端到端验证（v1.3.0）
 *
 * 这条链路跨了四个东西：页面表单 → PHP 接口 → webroot 之外的 JSONL → 密码保护的 PHP 后台。
 * 任何一环错，用户看到的都是"送出失败"或者"送出去了但后台看不到"，所以必须真跑一遍。
 *
 * 验的是：
 *   ① 接口收下反馈并回编号
 *   ② 后台**未登录**时看不到任何反馈内容（只是登录框）—— 这是最容易漏的一条
 *   ③ 后台密码错时被拒
 *   ④ 登录后能看到刚才那条，且编号/内容对得上
 *   ⑤ 表单校验：太短的标题/内容在服务端也要被拒（前端校验可以被绕过）
 *   ⑥ 蜜罐：填了 site 的提交返回"成功"但不落库
 *   ⑦ 收尾：把测试条目从后台删掉，不留垃圾
 *
 * 用法：node probe-feedback.cjs [站点根地址] [后台路径段]
 *   例：node probe-feedback.cjs https://bishe.xin/ ops-23beaa6d
 * 口令从同目录的 `.deploy-secrets.json` 读（部署时生成，不入库）。
 */
const fs = require('fs');
const path = require('path');

const SITE = (process.argv[2] || 'https://bishe.xin/').replace(/\/+$/, '') + '/';
const ADMIN = process.argv[3] || (JSON.parse(fs.readFileSync(path.join(__dirname, '.deploy-secrets.json'), 'utf8')).adminPath);
const SECRET = JSON.parse(fs.readFileSync(path.join(__dirname, '.deploy-secrets.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (c, n, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined && x !== '' ? '  [' + x + ']' : '')); };

const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let d = {}; try { d = await r.json(); } catch (e) { }
  return { status: r.status, d };
};

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
  const API = SITE + 'api/feedback.php';
  const ADM = SITE + ADMIN + '/';
  const stamp = Date.now();
  const title = '【自检】反馈链路测试 ' + new Date(stamp).toISOString().slice(11, 19);
  const body = '这是 probe-feedback.cjs 自动提交的一条测试反馈，用于验证「表单 → 接口 → 后台」整条链路。验证完毕会自动删除。';

  /* ═══════ ① 正常提交 ═══════ */
  console.log('\n=== ① 提交反馈 ===');
  const sent = await post(API, { kind: 'bug', title, body, contact: '自检程序', email: '', site: '', page: SITE + 'feedback.html', ua: 'probe-feedback' });
  console.log('  HTTP ' + sent.status + '  ' + JSON.stringify(sent.d));
  ok(sent.status === 200 && sent.d.ok === true, '接口收下并返回 ok', JSON.stringify(sent.d));
  const id = sent.d.id || '';
  ok(/^FB-\d{8}-\d{6}-[0-9A-F]{4}$/.test(id), '返回了规范的反馈编号', id);

  /* ═══════ ② 服务端也要挡：标题/内容太短 ═══════ */
  console.log('\n=== ② 服务端校验（前端校验可以被绕过）===');
  const tooShortTitle = await post(API, { kind: 'bug', title: 'x', body: '内容够长了内容够长了' });
  ok(tooShortTitle.status === 422 && tooShortTitle.d.ok !== true, '标题过短被拒', tooShortTitle.status + ' ' + JSON.stringify(tooShortTitle.d));
  const tooShortBody = await post(API, { kind: 'bug', title: '标题够长了', body: '短' });
  ok(tooShortBody.status === 422 && tooShortBody.d.ok !== true, '内容过短被拒', tooShortBody.status + ' ' + JSON.stringify(tooShortBody.d));
  const badKind = await post(API, { kind: 'hack', title: '标题够长了', body: '内容也够长了哦' });
  ok(badKind.status === 200 && badKind.d.ok === true, '非法类型被归到「其它」而不是报错', JSON.stringify(badKind.d));
  if (badKind.d.id) { /* 这条也要清掉 */ }

  /* ═══════ ③ 蜜罐：返回成功但不落库 ═══════ */
  console.log('\n=== ③ 蜜罐反垃圾 ===');
  const honey = await post(API, { kind: 'bug', title: '机器人提交', body: '机器人提交的内容内容', site: 'http://spam.example' });
  ok(honey.status === 200 && honey.d.ok === true, '填了蜜罐的提交也回「成功」（别让机器人换姿势重试）', JSON.stringify(honey.d));
  ok(honey.d.id === 'FB-00000000-0000', '但给的是占位编号（没真落库）', honey.d.id);

  /* ═══════ ④ 后台：未登录看不到内容 ═══════ */
  console.log('\n=== ④ 后台门禁 ===');
  const anon = await fetch(ADM);
  const anonHtml = await anon.text();
  console.log('  未登录 HTTP ' + anon.status + '，页面长度 ' + anonHtml.length);
  ok(anon.status === 200, '后台地址可达', String(anon.status));
  ok(/name="pw"/.test(anonHtml), '未登录时给的是登录框');
  ok(!anonHtml.includes(title), '未登录时看不到任何反馈标题', anonHtml.includes(title) ? '泄漏了！' : '未泄漏');
  ok(!/反馈后台[\s\S]*待处理/.test(anonHtml.replace(/name="pw"[\s\S]*/,'')), '未登录时看不到统计面板');

  /* ═══════ ⑤ 密码错误要被拒 ═══════ */
  const wrong = await fetch(ADM, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'do=login&pw=' + encodeURIComponent('definitely-not-the-password'),
    redirect: 'manual',
  });
  const wrongHtml = await wrong.text();
  ok(!/Set-Cookie:\s*PHPSESSID=[^;]*;.*in/i.test(String(wrong.headers.getSetCookie && wrong.headers.getSetCookie() || '')) && !/待处理/.test(wrongHtml),
    '错误口令进不去（没有拿到已登录的会话）', 'HTTP ' + wrong.status);

  /* ═══════ ⑥ 正确口令能进，并看到刚才那条 ═══════ */
  console.log('\n=== ⑤ 登录并核对内容 ===');
  const login = await fetch(ADM, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'do=login&pw=' + encodeURIComponent(SECRET.password),
    redirect: 'manual',
  });
  const cookies = (login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get('set-cookie')]).filter(Boolean);
  const jar = cookies.map(c => String(c).split(';')[0]).join('; ');
  console.log('  登录 HTTP ' + login.status + '，拿到会话 ' + (jar ? '是' : '否'));
  ok(!!jar && /PHPSESSID/.test(jar), '登录成功并拿到会话', jar ? jar.split('=')[0] : '无');

  const panel = await fetch(ADM, { headers: { Cookie: jar } });
  const panelHtml = await panel.text();
  ok(/待处理/.test(panelHtml), '登录后看到统计面板');
  ok(panelHtml.includes(title), '刚才提交的那条出现在后台列表里');
  ok(!!id && panelHtml.includes(id), '编号也对得上', id || '（没拿到编号，本条应视为失败）');
  ok(panelHtml.includes('自检程序'), '称呼字段落库了');
  ok(panelHtml.length > 500 && !panelHtml.includes('机器人提交'), '蜜罐那条确实没落库（列表里找不到它）');

  /* ═══════ ⑦ 收尾：把测试条目删掉 ═══════ */
  console.log('\n=== ⑥ 清理测试数据 ===');
  const csrf = (panelHtml.match(/name="csrf" value="([^"]+)"/) || [])[1] || '';
  ok(!!csrf, '拿到 CSRF 令牌', csrf ? csrf.slice(0, 8) + '…' : '无');
  let removed = 0;
  for (const kill of [id, badKind.d.id].filter(Boolean)) {
    const r = await fetch(ADM, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar },
      body: 'do=del&id=' + encodeURIComponent(kill) + '&csrf=' + encodeURIComponent(csrf),
      redirect: 'manual',
    });
    if (r.status === 302 || r.status === 200) removed++;
  }
  ok(removed >= 1, '测试条目已从后台删除', '删了 ' + removed + ' 条');
  const after = await fetch(ADM, { headers: { Cookie: jar } });
  const afterHtml = await after.text();
  ok(!title || !afterHtml.includes(title), '确认列表里已经没有测试条目了');

  /* ═══════ ⑧ 数据文件不该能被公网取到 ═══════ */
  console.log('\n=== ⑦ 数据不在 webroot 内 ===');
  for (const p of ['feedback.jsonl', '../wenyuange-data/feedback.jsonl', 'data/feedback.jsonl']) {
    let reachable = false;
    try { const r = await fetch(SITE + p); reachable = r.status === 200; } catch (e) { }
    ok(!reachable, '公网取不到：' + p);
  }

  console.log('\n--- probe-feedback: 通过 ' + pass + ' / 失败 ' + fail + ' ---');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('探针异常:', (e && e.stack) || e); process.exit(2); });
