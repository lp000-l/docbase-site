<?php
/*
 * config.example.php —— 反馈后台的配置模板（真正的 config.php 在服务器上，
 * 位置是 webroot 之外的 /www/wwwroot/wenyuange-data/config.php，不进仓库）。
 *
 *   password_hash  —— 网页版后台（ops-23beaa6d/index.php）的登录密码哈希，
 *                     用 password_hash('你的密码', PASSWORD_DEFAULT) 生成。
 *   api_token      —— 反馈台桌面软件的口令。桌面端把它放在 X-FB-Token 请求头里。
 *                     换口令只需改这里，服务端与后台代码都不用动。
 *
 * 两个值都给外人看到都不要紧（哈希与随机口令本身不能反推），
 * 但**不要**把这两行连同明文密码一起提交到任何公开仓库。
 */
return [
    'password_hash' => '<password_hash() 生成的一串>',
    'api_token'     => '<一段随机字符串，建议 32 位以上>',
];
