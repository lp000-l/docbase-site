/*
 * patch-cors.cjs —— 给 `deploy/api/feedback.php` 加上「放行镜像站跨域提交」的一小段
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 为什么需要：GitHub Pages 镜像站上的 `feedback.html` 把表单提交到
 * `https://bishe.xin/api/feedback.php` —— 这是**跨域**请求，浏览器会先发 OPTIONS 预检；
 * 服务端不回 `Access-Control-Allow-Origin` 的话，表单会永远"送不出去"。
 *
 * 放行范围**只给白名单**，不是 `*`：
 *   · 本站自己（bishe.xin / www.bishe.xin）
 *   · 指定那一个 GitHub Pages 源（`https://<login>.github.io`，不含子路径 —— CORS 只看源）
 * 别的来源一律不回 CORS 头，浏览器那边自然就拦住了。写进数据的路径没变：
 * 蜜罐、每 IP 限流、IP 只存哈希、flock 独占，全都照旧生效。
 *
 * 用法：
 *   node patch-cors.cjs --gh=lp000-l        # 打补丁（幂等，重复跑不会叠两遍）
 *   node patch-cors.cjs --show              # 只看现在放了哪些源
 * 打完还要 scp 到服务器才生效（脚本最后会打印命令）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PHP = path.join(__dirname, 'deploy', 'api', 'feedback.php');
const MARK_A = '/* ==== 镜像站跨域放行（patch-cors.cjs 插入，勿手改）==== */';
const MARK_B = '/* ==== 镜像站跨域放行结束 ==== */';
const opt = k => { const m = process.argv.find(a => a.startsWith('--' + k + '=')); return m ? m.slice(k.length + 3) : ''; };
const GH = opt('gh');

let s = fs.readFileSync(PHP, 'utf8');
const has = s.includes(MARK_A);

if (process.argv.includes('--show') || (has && !GH)) {
  if (!has) { console.log('现在没有 CORS 块（镜像站的表单提交会被浏览器拦下）'); process.exit(0); }
  const blk = s.slice(s.indexOf(MARK_A), s.indexOf(MARK_B));
  console.log('已有的 CORS 块：\n' + blk);
  process.exit(0);
}
if (!GH) { console.error('✗ 缺少 --gh=<GitHub 用户名>（要放行 https://<用户名>.github.io）'); process.exit(1); }
if (!/^[A-Za-z0-9-]+$/.test(GH)) { console.error('✗ GitHub 用户名不合法：' + GH); process.exit(1); }

const block = [
  MARK_A,
  '/* 只放行白名单来源：本站 + 指定那一个 GitHub Pages 源。',
  '   注意 CORS 比的是**源**（scheme+host+port），不含路径，所以 github.io 那边不用带仓库名。',
  '   预检（OPTIONS）必须在"只接受 POST"那道判断**之前**处理掉，否则预检会被 405 顶回去、表单永远送不出去。 */',
  'const CORS_OK = [',
  "    'https://bishe.xin',",
  "    'https://www.bishe.xin',",
  "    'https://" + GH + ".github.io',",
  '];',
  '$origin = (string)($_SERVER[\'HTTP_ORIGIN\'] ?? \'\');',
  'if ($origin !== \'\' && in_array($origin, CORS_OK, true)) {',
  '    header(\'Access-Control-Allow-Origin: \' . $origin);',
  '    header(\'Vary: Origin\');',
  '    header(\'Access-Control-Allow-Methods: POST, OPTIONS\');',
  '    header(\'Access-Control-Allow-Headers: Content-Type\');',
  '    header(\'Access-Control-Max-Age: 600\');',
  '}',
  'if (($_SERVER[\'REQUEST_METHOD\'] ?? \'\') === \'OPTIONS\') { http_response_code(204); exit; }',
  MARK_B,
  '',
].join('\n');

if (has) {
  /* 换掉旧块（用户名变了时直接替换，绝不叠加两份） */
  const a = s.indexOf(MARK_A), b = s.indexOf(MARK_B) + MARK_B.length;
  s = s.slice(0, a) + block.trimEnd() + s.slice(b);
  console.log('✓ 已替换原来的 CORS 块（改为放行 https://' + GH + '.github.io）');
} else {
  /* 插在 header(...) 之后、"只接受 POST"之前 —— 顺序很关键 */
  const anchor = "if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, '只接受 POST');";
  if (!s.includes(anchor)) { console.error("✗ 找不到锚点（'只接受 POST' 那行变了？）"); process.exit(1); }
  s = s.split(anchor).join(block + anchor);
  console.log('✓ 已插入 CORS 块（放行 https://' + GH + '.github.io）');
}
fs.writeFileSync(PHP, s);

/* 粗校验：PHP 标签成对、块只出现一次 */
const tags = (s.match(/<\?php/g) || []).length;
const once = (s.match(new RegExp(MARK_A.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
console.log('  <?php ' + tags + ' 处 · CORS 块 ' + once + ' 份 · 文件 ' + fs.statSync(PHP).size + ' 字节');
if (once !== 1) { console.error('✗ CORS 块不是恰好一份，请检查'); process.exit(1); }
console.log('\n生效还需上传到服务器：');
console.log('  scp -F /dev/null -i "C:/Users/17760/Desktop/服务器/first.pem" deploy/api/feedback.php root@8.208.113.137:/www/wwwroot/wenyuange/api/feedback.php');
