<?php
/*
 * feedback.php —— 官网反馈接收入口（v1.3.0）
 *
 * 只做一件事：把反馈安全地落到 webroot 之外的一个 JSONL 文件里。后台由
 * admin 目录下的另一个脚本读同一个文件。
 *
 * 放在 webroot 之外的考虑：反馈里可能有联系方式、也可能有用户贴过来的本机路径，
 * 这些不该有一次失误就变成公网可下载的静态文件。所以数据目录与配置都在站点目录之外。
 *
 * 防护：
 *   · 只接受 POST + JSON
 *   · 蜜罐字段 site 一旦有值 → 直接返回成功但不落库（机器人以为成功，真人根本看不见这个框）
 *   · 每 IP 限流（默认每小时 6 条、每天 30 条）
 *   · 长度与取值全部白名单/截断，绝不原样落库后交给后台拼 HTML
 *   · 写入用 flock 独占锁，避免并发追加互相截断
 */
declare(strict_types=1);

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

const DATA_DIR = '/www/wwwroot/wenyuange-data';
const KINDS = ['bug', 'suggest', 'ask', 'other'];
const RATE_HOUR = 6;
const RATE_DAY  = 30;

function fail(int $code, string $msg): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, '只接受 POST');

$raw = file_get_contents('php://input', false, null, 0, 65536);
if ($raw === false || $raw === '') fail(400, '没有收到内容');
$in = json_decode($raw, true);
if (!is_array($in)) fail(400, '内容格式不对（应为 JSON）');

/* ── 蜜罐 ── */
if (trim((string)($in['site'] ?? '')) !== '') {
    /* 不落库，但回一个"成功"，让机器人别再换姿势重试 */
    echo json_encode(['ok' => true, 'id' => 'FB-00000000-0000'], JSON_UNESCAPED_UNICODE);
    exit;
}

$kind  = in_array(($in['kind'] ?? ''), KINDS, true) ? (string)$in['kind'] : 'other';
$title = trim((string)($in['title'] ?? ''));
$body  = trim((string)($in['body'] ?? ''));
$email = trim((string)($in['email'] ?? ''));
$name  = trim((string)($in['contact'] ?? ''));
$page  = trim((string)($in['page'] ?? ''));
$ua    = trim((string)($in['ua'] ?? ''));

/* mb_* 在部分精简 PHP 里没装；用 mb 优先、字节截断兜底，保证不会因为缺函数而 500 */
function cut(string $s, int $n): string {
    if (function_exists('mb_substr')) return mb_substr($s, 0, $n, 'UTF-8');
    return substr($s, 0, $n * 3);
}
function len(string $s): int {
    if (function_exists('mb_strlen')) return mb_strlen($s, 'UTF-8');
    return (int)ceil(strlen($s) / 3);
}

if (len($title) < 2)  fail(422, '标题太短');
if (len($body) < 5)   fail(422, '内容太短');
if (len($body) > 4000) $body = cut($body, 4000);
if (len($title) > 80)  $title = cut($title, 80);
if (len($name) > 60)   $name = cut($name, 60);
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) fail(422, '邮箱格式不对');
if (strlen($email) > 120) $email = substr($email, 0, 120);

if (!is_dir(DATA_DIR)) {
    /* 目录由部署脚本预建；这里只是兜底，别让它默默失败后用户以为"送出去了" */
    if (!@mkdir(DATA_DIR, 0700, true)) fail(500, '服务端数据目录不可用');
}

/* ── 限流（按 IP） ── */
$ip = (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
$fk = DATA_DIR . '/ratelimit.json';
$now = time();
$rl = [];
if (is_file($fk)) {
    $tmp = json_decode((string)@file_get_contents($fk), true);
    if (is_array($tmp)) $rl = $tmp;
}
$key = hash('sha256', $ip);
$mine = array_values(array_filter((array)($rl[$key] ?? []), fn($t) => is_int($t) && $t > $now - 86400));
if (count($mine) >= RATE_DAY) fail(429, '今天提交得有点多，请明天再试');
$lastHour = array_values(array_filter($mine, fn($t) => $t > $now - 3600));
if (count($lastHour) >= RATE_HOUR) fail(429, '短时间内提交太多，请过一会儿再试');

/* ── 落库 ── */
$id = 'FB-' . date('Ymd-His') . '-' . strtoupper(substr(bin2hex(random_bytes(3)), 0, 4));
$rec = [
    'id' => $id,
    'ts' => date('c'),
    'kind' => $kind,
    'title' => $title,
    'body' => $body,
    'contact' => $name,
    'email' => $email,
    'page' => cut($page, 200),
    'ua' => cut($ua, 200),
    /* IP 只存哈希：后台能看出「同一个人提了好几次」，但没有明文地址留在盘上 */
    'ip' => substr($key, 0, 16),
    'done' => false,
];

$fh = @fopen(DATA_DIR . '/feedback.jsonl', 'ab');
if (!$fh) fail(500, '写入失败，请稍后再试');
flock($fh, LOCK_EX);
fwrite($fh, json_encode($rec, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
fflush($fh);
flock($fh, LOCK_UN);
fclose($fh);

/* 限流记录：先剪掉过期条目，避免文件无限长 */
$mine[] = $now;
$rl[$key] = $mine;
if (count($rl) > 5000) {
    /* 只留最近一天还有记录的 key */
    $rl = array_filter($rl, fn($v) => is_array($v) && count(array_filter($v, fn($t) => is_int($t) && $t > $now - 86400)) > 0);
}
@file_put_contents($fk, json_encode($rl), LOCK_EX);

echo json_encode(['ok' => true, 'id' => $id], JSON_UNESCAPED_UNICODE);
