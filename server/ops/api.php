<?php
/*
 * api.php —— 反馈台（桌面小软件）用的取数接口（v1.4.0）
 *
 * 与同目录的 index.php 读同一份数据（webroot 之外的 feedback.jsonl），
 * 区别只在于认证方式：网页版用会话密码，这里用固定口令（X-FB-Token 头）。
 * 为什么单独开一个口：桌面软件没有浏览器的会话/Cookie，用口令更直接；
 * 而且口令走**请求头**而不是查询串，避免被 nginx 的 access log 记下来。
 *
 * 安全约定：
 *   · 口令只存在 webroot 之外的 config.php 里，本文件不含任何密码；
 *   · 比较用 hash_equals（定长比较，不给逐字节试探留时间差）；
 *   · 没有口令或口令不对 → 一律 404，连「这里有个接口」都不承认；
 *   · 不输出任何用户提交的 HTML —— 桌面端按纯文本渲染，这里也只回 JSON 原串。
 */
declare(strict_types=1);

const DATA_DIR = '/www/wwwroot/wenyuange-data';
const CONF = DATA_DIR . '/config.php';
const STORE = DATA_DIR . '/feedback.jsonl';

header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');

function out(array $a, int $code = 200): void {
    http_response_code($code);
    echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function deny(): void { out(['ok' => false, 'error' => '没有这个接口'], 404); }

$conf = is_file(CONF) ? require CONF : [];
$want = is_string($conf['api_token'] ?? null) ? (string)$conf['api_token'] : '';
if ($want === '') deny();

$got = (string)($_SERVER['HTTP_X_FB_TOKEN'] ?? '');
if ($got === '' && isset($_GET['token'])) $got = (string)$_GET['token'];
if ($got === '' || !hash_equals($want, $got)) {
    usleep(300000);              /* 拖一下，压暴力猜的速度 */
    deny();
}

/* ───────── 读写 feedback.jsonl ───────── */
function loadAll(): array {
    if (!is_file(STORE)) return [];
    $out = [];
    $fh = @fopen(STORE, 'rb');
    if (!$fh) return [];
    while (($line = fgets($fh)) !== false) {
        $line = trim($line);
        if ($line === '') continue;
        $r = json_decode($line, true);
        /* 同一 id 只留最后一条：改过状态的记录会以新副本追加，读取时以后者为准 */
        if (is_array($r) && isset($r['id'])) $out[(string)$r['id']] = $r;
    }
    fclose($fh);
    return array_values($out);
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
function cut(string $s, int $n): string {
    if (function_exists('mb_substr')) return mb_substr($s, 0, $n, 'UTF-8');
    return substr($s, 0, $n * 3);
}
function len(string $s): int {
    if (function_exists('mb_strlen')) return mb_strlen($s, 'UTF-8');
    return (int)ceil(strlen($s) / 3);
}

$raw = file_get_contents('php://input', false, null, 0, 262144);
$in = $raw !== false && $raw !== '' ? json_decode($raw, true) : [];
if (!is_array($in)) $in = [];
$action = (string)($in['action'] ?? $_GET['action'] ?? '');

/* ───────── ping：桌面端「连接自检」用，顺带报一下版本与条数 ───────── */
if ($action === 'ping') {
    $rows = loadAll();
    $open = 0;
    foreach ($rows as $r) if (empty($r['done'])) $open++;
    out(['ok' => true, 'total' => count($rows), 'open' => $open, 'api' => 1]);
}

/* ───────── list：筛选 + 搜索 + 分页 ───────── */
if ($action === 'list') {
    $kind  = (string)($_GET['kind'] ?? 'all');
    $state = (string)($_GET['state'] ?? 'all');
    $q     = trim((string)($_GET['q'] ?? ''));
    $limit = max(1, min(500, (int)($_GET['limit'] ?? 200)));
    $off   = max(0, (int)($_GET['offset'] ?? 0));

    $rows = loadAll();
    /* 新的在前：id 里带时间戳（FB-YYYYmmdd-HHMMSS-xxxx），按 id 倒序即按时间倒序 */
    usort($rows, fn($a, $b) => strcmp((string)($b['id'] ?? ''), (string)($a['id'] ?? '')));

    $counts = ['total' => count($rows), 'open' => 0, 'done' => 0, 'bug' => 0, 'suggest' => 0, 'ask' => 0, 'other' => 0];
    foreach ($rows as $r) {
        if (empty($r['done'])) $counts['open']++; else $counts['done']++;
        $k = (string)($r['kind'] ?? 'other');
        if (isset($counts[$k])) $counts[$k]++;
    }

    $hit = array_filter($rows, function ($r) use ($kind, $state, $q) {
        if ($kind !== 'all' && (string)($r['kind'] ?? '') !== $kind) return false;
        if ($state === 'open' && !empty($r['done'])) return false;
        if ($state === 'done' && empty($r['done'])) return false;
        if ($q !== '') {
            $hay = (string)($r['title'] ?? '') . ' ' . (string)($r['body'] ?? '') . ' '
                 . (string)($r['contact'] ?? '') . ' ' . (string)($r['email'] ?? '') . ' ' . (string)($r['id'] ?? '');
            if (mb_stripos($hay, $q) === false) return false;
        }
        return true;
    });
    $hit = array_values($hit);
    $page = array_slice($hit, $off, $limit);

    out([
        'ok' => true,
        'counts' => $counts,
        'filtered' => count($hit),
        'offset' => $off,
        'items' => array_map(fn($r) => [
            'id' => (string)($r['id'] ?? ''),
            'ts' => (string)($r['ts'] ?? ''),
            'kind' => (string)($r['kind'] ?? 'other'),
            'title' => (string)($r['title'] ?? ''),
            'body' => (string)($r['body'] ?? ''),
            'contact' => (string)($r['contact'] ?? ''),
            'email' => (string)($r['email'] ?? ''),
            'page' => (string)($r['page'] ?? ''),
            'ua' => (string)($r['ua'] ?? ''),
            'ip' => (string)($r['ip'] ?? ''),
            'done' => !empty($r['done']),
            'doneAt' => (string)($r['doneAt'] ?? ''),
            'note' => (string)($r['note'] ?? ''),
        ], $page),
    ]);
}

/* ───────── mark：标记已处理 / 取消标记 ───────── */
if ($action === 'mark') {
    $id = trim((string)($in['id'] ?? ''));
    if ($id === '') out(['ok' => false, 'error' => '缺少 id'], 400);
    $rows = loadAll();
    $found = false;
    foreach ($rows as $i => $r) {
        if ((string)($r['id'] ?? '') !== $id) continue;
        $rows[$i]['done'] = !empty($in['done']);
        $rows[$i]['doneAt'] = $rows[$i]['done'] ? date('c') : '';
        $found = true;
        break;
    }
    if (!$found) out(['ok' => false, 'error' => '没有这条反馈（可能已被清理）'], 404);
    if (!saveAll($rows)) out(['ok' => false, 'error' => '写回失败，请稍后再试'], 500);
    out(['ok' => true]);
}

/* ───────── note：写自己的处理备注（只有后台看得见） ───────── */
if ($action === 'note') {
    $id = trim((string)($in['id'] ?? ''));
    if ($id === '') out(['ok' => false, 'error' => '缺少 id'], 400);
    $note = cut(trim((string)($in['note'] ?? '')), 2000);
    $rows = loadAll();
    $found = false;
    foreach ($rows as $i => $r) {
        if ((string)($r['id'] ?? '') !== $id) continue;
        $rows[$i]['note'] = $note;
        $found = true;
        break;
    }
    if (!$found) out(['ok' => false, 'error' => '没有这条反馈'], 404);
    if (!saveAll($rows)) out(['ok' => false, 'error' => '写回失败，请稍后再试'], 500);
    out(['ok' => true]);
}

out(['ok' => false, 'error' => '不认识这个 action：' . cut($action, 40)], 400);
