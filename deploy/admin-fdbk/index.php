<?php
/*
 * 反馈后台（v1.3.0）—— 只看一件事：官网收到的反馈。
 *
 * 部署在站点目录下的一个不显眼路径里，并且必须先输密码。密码哈希与反馈数据都在
 * webroot 之外（/www/wwwroot/wenyuange-data），所以就算站点目录被人改了也拿不到反馈内容。
 *
 * 设计上刻意保持"小"：单个文件、无数据库、无外部依赖、无写死的密码 ——
 * 密码哈希改动不需要动这个文件，重新写 config.php 即可。
 */
declare(strict_types=1);
session_start();

const DATA_DIR = '/www/wwwroot/wenyuange-data';
const CONF = DATA_DIR . '/config.php';
const STORE = DATA_DIR . '/feedback.jsonl';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');

$conf = is_file(CONF) ? require CONF : [];
$passHash = is_string($conf['password_hash'] ?? null) ? $conf['password_hash'] : '';
if ($passHash === '') {
    http_response_code(500);
    echo '后台尚未配置密码：请在 ' . CONF . ' 里写入 password_hash。';
    exit;
}

const KINDS = ['bug' => '出了问题', 'suggest' => '功能建议', 'ask' => '使用疑问', 'other' => '其它'];

function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function token(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return (string)$_SESSION['csrf'];
}
function checkToken(): void {
    $t = (string)($_POST['csrf'] ?? $_GET['csrf'] ?? '');
    if ($t === '' || !hash_equals((string)($_SESSION['csrf'] ?? ''), $t)) {
        http_response_code(400);
        exit('校验失败，请返回重试。');
    }
}
function loadAll(): array {
    if (!is_file(STORE)) return [];
    $out = [];
    $fh = @fopen(STORE, 'rb');
    if (!$fh) return [];
    while (($line = fgets($fh)) !== false) {
        $line = trim($line);
        if ($line === '') continue;
        $r = json_decode($line, true);
        if (is_array($r) && isset($r['id'])) $out[] = $r;
    }
    fclose($fh);
    return $out;
}
function saveAll(array $rows): bool {
    $tmp = STORE . '.tmp';
    $fh = @fopen($tmp, 'wb');
    if (!$fh) return false;
    flock($fh, LOCK_EX);
    foreach ($rows as $r) fwrite($fh, json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
    fflush($fh); flock($fh, LOCK_UN); fclose($fh);
    return @rename($tmp, STORE);
}

/* ───────── 登录 / 登出 ───────── */
if (isset($_GET['logout'])) {
    $_SESSION = []; session_destroy();
    header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'));
    exit;
}
$loginErr = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['do'] ?? '') === 'login') {
    $pw = (string)($_POST['pw'] ?? '');
    usleep(400000);                                   /* 拖一下，压暴力猜的速度 */
    if (password_verify($pw, $passHash)) {
        $_SESSION['in'] = true;
        session_regenerate_id(true);
        header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'));
        exit;
    }
    $loginErr = '密码不对。';
}
$logged = !empty($_SESSION['in']);

$rows = $logged ? loadAll() : [];

/* ───────── 动作（仅登录后） ───────── */
if ($logged && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $do = (string)($_POST['do'] ?? '');
    if (in_array($do, ['done', 'undone', 'del'], true)) {
        checkToken();
        $id = (string)($_POST['id'] ?? '');
        $next = [];
        foreach ($rows as $r) {
            if (($r['id'] ?? '') !== $id) { $next[] = $r; continue; }
            if ($do === 'del') continue;
            $r['done'] = ($do === 'done');
            $next[] = $r;
        }
        saveAll($next);
        header('Location: ?' . http_build_query(array_diff_key($_POST, ['do' => 1, 'id' => 1, 'csrf' => 1])));
        exit;
    }
    if ($do === 'export') {
        checkToken();
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename*=UTF-8\'\'feedback-' . date('Ymd-His') . '.csv');
        $out = fopen('php://output', 'wb');
        fwrite($out, "\xEF\xBB\xBF");                  /* BOM：Excel 打开中文不乱码 */
        fputcsv($out, ['编号', '时间', '类型', '标题', '内容', '称呼', '邮箱', '来源页', 'UA', 'IP哈希', '已处理']);
        foreach ($rows as $r) {
            fputcsv($out, [
                $r['id'] ?? '', $r['ts'] ?? '', KINDS[$r['kind'] ?? 'other'] ?? '其它',
                $r['title'] ?? '', $r['body'] ?? '', $r['contact'] ?? '', $r['email'] ?? '',
                $r['page'] ?? '', $r['ua'] ?? '', $r['ip'] ?? '',
                !empty($r['done']) ? '是' : '否',
            ]);
        }
        fclose($out);
        exit;
    }
}

/* ───────── 筛选 ───────── */
$fKind = (string)($_GET['kind'] ?? '');
$fStat = (string)($_GET['stat'] ?? '');
$q     = trim((string)($_GET['q'] ?? ''));
$shown = $rows;
if (in_array($fKind, array_keys(KINDS), true)) $shown = array_filter($shown, fn($r) => ($r['kind'] ?? '') === $fKind);
if ($fStat === 'todo')   $shown = array_filter($shown, fn($r) => empty($r['done']));
if ($fStat === 'done')   $shown = array_filter($shown, fn($r) => !empty($r['done']));
if ($q !== '') {
    $needle = function_exists('mb_strtolower') ? mb_strtolower($q, 'UTF-8') : strtolower($q);
    $shown = array_filter($shown, function ($r) use ($needle) {
        $hay = implode(' ', [(string)($r['title'] ?? ''), (string)($r['body'] ?? ''), (string)($r['contact'] ?? ''), (string)($r['email'] ?? ''), (string)($r['id'] ?? '')]);
        $hay = function_exists('mb_strtolower') ? mb_strtolower($hay, 'UTF-8') : strtolower($hay);
        return strpos($hay, $needle) !== false;
    });
}
usort($shown, fn($a, $b) => strcmp((string)($b['ts'] ?? ''), (string)($a['ts'] ?? '')));
$todo = count(array_filter($rows, fn($r) => empty($r['done'])));
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>反馈后台 · 文渊阁</title>
<style>
  :root { --paper:#f4ede0; --card:#faf6ec; --ink:#231f1a; --ink-2:#5a5245; --ink-3:#8b8371;
          --line:#e2d8c4; --line-strong:#cbbda1; --seal:#b3402a; --seal-soft:rgba(179,64,42,.09); --ok:#2f6b4a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.7 "Songti SC","SimSun",Georgia,serif; }
  .wrap { max-width: 1080px; margin:0 auto; padding: 28px 20px 80px; }
  header.bar { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; padding-bottom:16px; border-bottom:1px solid var(--line); }
  h1 { font-size:22px; margin:0; }
  .sub { color:var(--ink-3); font-size:13px; }
  .grow { flex:1; }
  .stat { display:flex; gap:18px; flex-wrap:wrap; margin:18px 0; }
  .stat b { font-size:22px; }
  .stat div { background:var(--card); border:1px solid var(--line-strong); border-radius:8px; padding:10px 16px; min-width:104px; }
  .stat span { display:block; font-size:12px; color:var(--ink-3); }
  .filters { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:18px 0; }
  input[type=text], input[type=password], select { font:inherit; padding:7px 10px; border:1px solid var(--line-strong); border-radius:6px; background:var(--card); color:var(--ink); }
  .btn { font:inherit; padding:7px 14px; border:1px solid var(--line-strong); background:var(--card); color:var(--ink); border-radius:6px; cursor:pointer; text-decoration:none; display:inline-block; }
  .btn:hover { background:var(--seal-soft); border-color:var(--seal); color:var(--seal); }
  .btn.primary { background:var(--ink); border-color:var(--ink); color:var(--card); }
  .btn.primary:hover { background:var(--seal); border-color:var(--seal); color:#fff8ee; }
  .btn.sm { padding:3px 9px; font-size:13px; }
  article { background:var(--card); border:1px solid var(--line-strong); border-left:3px solid var(--line-strong); border-radius:8px; padding:14px 16px; margin-bottom:12px; }
  article.todo { border-left-color: var(--seal); }
  article.done { opacity:.62; border-left-color: var(--ok); }
  .row1 { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  .id { font-family: ui-monospace,Consolas,monospace; font-size:12px; color:var(--ink-3); }
  .kind { font-size:12px; padding:1px 8px; border-radius:99px; border:1px solid var(--line-strong); color:var(--ink-2); }
  .kind.bug { border-color:var(--seal); color:var(--seal); }
  .t { font-weight:700; font-size:16px; }
  .when { margin-left:auto; font-size:12px; color:var(--ink-3); }
  pre.body { white-space:pre-wrap; word-break:break-word; margin:10px 0 8px; font:14px/1.8 "Songti SC","SimSun",serif; color:var(--ink-2); }
  .meta { font-size:12px; color:var(--ink-3); word-break:break-all; }
  .acts { display:flex; gap:8px; margin-top:10px; }
  .empty { color:var(--ink-3); padding:40px 0; text-align:center; }
  .login { max-width:340px; margin:80px auto; background:var(--card); border:1px solid var(--line-strong); border-radius:10px; padding:26px; }
  .login h1 { font-size:19px; margin-bottom:16px; }
  .login input { width:100%; margin-bottom:12px; }
  .err { color:var(--seal); font-size:13px; margin-bottom:10px; }
</style>
</head>
<body>
<?php if (!$logged): ?>
  <div class="login">
    <h1>反馈后台</h1>
    <?php if ($loginErr !== ''): ?><div class="err"><?= h($loginErr) ?></div><?php endif; ?>
    <form method="post">
      <input type="hidden" name="do" value="login">
      <input type="password" name="pw" placeholder="密码" autofocus autocomplete="current-password">
      <button class="btn primary" type="submit" style="width:100%">进入</button>
    </form>
  </div>
<?php else: ?>
  <div class="wrap">
    <header class="bar">
      <h1>反馈后台</h1>
      <span class="sub">文渊阁 DocBase · 官网反馈</span>
      <span class="grow"></span>
      <form method="post" style="display:inline">
        <input type="hidden" name="do" value="export">
        <input type="hidden" name="csrf" value="<?= h(token()) ?>">
        <button class="btn sm" type="submit">导出 CSV</button>
      </form>
      <a class="btn sm" href="?logout=1">退出</a>
    </header>

    <div class="stat">
      <div><b><?= count($rows) ?></b><span>全部</span></div>
      <div><b style="color:var(--seal)"><?= $todo ?></b><span>待处理</span></div>
      <div><b><?= count($rows) - $todo ?></b><span>已处理</span></div>
    </div>

    <form class="filters" method="get">
      <select name="kind">
        <option value="">全部类型</option>
        <?php foreach (KINDS as $k => $label): ?>
          <option value="<?= h($k) ?>"<?= $fKind === $k ? ' selected' : '' ?>><?= h($label) ?></option>
        <?php endforeach; ?>
      </select>
      <select name="stat">
        <option value="">全部状态</option>
        <option value="todo"<?= $fStat === 'todo' ? ' selected' : '' ?>>待处理</option>
        <option value="done"<?= $fStat === 'done' ? ' selected' : '' ?>>已处理</option>
      </select>
      <input type="text" name="q" value="<?= h($q) ?>" placeholder="搜标题 / 内容 / 邮箱 / 编号" style="min-width:240px">
      <button class="btn" type="submit">筛选</button>
      <?php if ($fKind !== '' || $fStat !== '' || $q !== ''): ?><a class="btn sm" href="?">清空</a><?php endif; ?>
      <span class="sub">显示 <?= count($shown) ?> / <?= count($rows) ?> 条</span>
    </form>

    <?php if (!$shown): ?>
      <div class="empty">没有符合条件的反馈。</div>
    <?php else: foreach ($shown as $r): ?>
      <article class="<?= !empty($r['done']) ? 'done' : 'todo' ?>">
        <div class="row1">
          <span class="id"><?= h($r['id'] ?? '') ?></span>
          <span class="kind <?= h($r['kind'] ?? 'other') ?>"><?= h(KINDS[$r['kind'] ?? 'other'] ?? '其它') ?></span>
          <span class="t"><?= h($r['title'] ?? '') ?></span>
          <span class="when"><?= h((string)($r['ts'] ?? '')) ?></span>
        </div>
        <pre class="body"><?= h($r['body'] ?? '') ?></pre>
        <div class="meta">
          <?php if (!empty($r['contact'])): ?>称呼：<?= h($r['contact']) ?>　<?php endif; ?>
          <?php if (!empty($r['email'])): ?>邮箱：<a href="mailto:<?= h($r['email']) ?>"><?= h($r['email']) ?></a>　<?php endif; ?>
          <?php if (!empty($r['page'])): ?>来源：<?= h($r['page']) ?>　<?php endif; ?>
          <?php if (!empty($r['ua'])): ?><br>UA：<?= h($r['ua']) ?><?php endif; ?>
          <?php if (!empty($r['ip'])): ?><br>IP 哈希：<?= h($r['ip']) ?><?php endif; ?>
        </div>
        <div class="acts">
          <form method="post" style="display:inline">
            <input type="hidden" name="do" value="<?= !empty($r['done']) ? 'undone' : 'done' ?>">
            <input type="hidden" name="id" value="<?= h($r['id'] ?? '') ?>">
            <input type="hidden" name="csrf" value="<?= h(token()) ?>">
            <input type="hidden" name="kind" value="<?= h($fKind) ?>">
            <input type="hidden" name="stat" value="<?= h($fStat) ?>">
            <input type="hidden" name="q" value="<?= h($q) ?>">
            <button class="btn sm" type="submit"><?= !empty($r['done']) ? '标为待处理' : '标为已处理' ?></button>
          </form>
          <form method="post" style="display:inline" onsubmit="return confirm('删除这条反馈？不可恢复。')">
            <input type="hidden" name="do" value="del">
            <input type="hidden" name="id" value="<?= h($r['id'] ?? '') ?>">
            <input type="hidden" name="csrf" value="<?= h(token()) ?>">
            <input type="hidden" name="kind" value="<?= h($fKind) ?>">
            <input type="hidden" name="stat" value="<?= h($fStat) ?>">
            <input type="hidden" name="q" value="<?= h($q) ?>">
            <button class="btn sm" type="submit">删除</button>
          </form>
        </div>
      </article>
    <?php endforeach; endif; ?>
  </div>
<?php endif; ?>
</body>
</html>
