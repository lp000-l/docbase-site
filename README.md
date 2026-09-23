# 文渊阁 DocBase · 官网

## 设计定调

- **目的**：为「文渊阁 DocBase」文件管理器做官网，展示核心能力并引导 Windows 版下载。
- **调性**：**古风档案**（杂志编辑 × 轻奢雅致）—— 宣纸底、浓墨字、朱砂印，克制而有骨。
- **记忆点**：竖排小签「载籍极博 · 一器纳之」；卷轴式册页分类卡；朱笔圈点的标题；竹简质感终端。

**字体**
- 展示字：霞鹜文楷 LXGW WenKai（古雅手写骨感）→ 回退 思源宋体 Noto Serif SC
- 正文字：思源宋体 Noto Serif SC（衬线，宣纸气质）
- 标签字：思源黑体 Noto Sans SC（小字号识读清晰）

**配色（CSS 变量）**

| 令牌 | 值 | 用途 |
|---|---|---|
| `--paper` | `#f4ede0` | 宣纸主底 |
| `--paper-2` | `#ece2d0` | 次级纸面 / 卡片 |
| `--paper-3` | `#e2d5be` | 折叠暗面 / 标签底 |
| `--ink` | `#221c15` | 浓墨正文 |
| `--ink-2` | `#4a4038` | 淡墨 |
| `--ink-3` | `#857a6b` | 灰墨（次要文字） |
| `--cinnabar` | `#a8322a` | **唯一强调色**：印章 / 关键动作 |
| `--bamboo` | `#5c6b52` | 竹青（功能标签点缀） |
| `--azure` | `#3f5a6b` | 石青（功能标签点缀） |

> 强调色纪律：单屏只有一个朱砂红，只给印章与「下载」动作。

## 运行方式

浏览器直接打开 `index.html` 即可，无需构建。

## 文件结构

```
index.html      # 主页（首屏 / 功能 / 运行 / 下载 / 最近三版手记）
journal.html    # 更新手记专页（历次修订全在这里）
feedback.html   # 反馈页（表单 POST 到 api/feedback.php）
site.css        # 全站共用样式（v1.3.0 从 index.html 内联样式抽出，三页共用）
site.js         # 全站共用行为（入场动效 / 锚点滚动 / 手机端抽屉与回顶 / 复制下载链接）
purity.json     # 校验清单（由软件侧 build-purity.cjs 生成，随包部署；可不提交）
README.md       # 定调说明与本页
probe-site.cjs      # 站点一致性校验：下载卡 / 校验码表 / 手记条目 / 子页 / 站内死链
probe-feedback.cjs  # 反馈链路端到端（含后台门禁与反垃圾），会自建再自删一条测试反馈
shot-site.cjs       # 线上骨架校验（下载链 / HEAD+Range）+ 桌面截图
shot-mobile.cjs     # 手机端适配验证（8 档设备模拟 + 体检 + 截图）
deploy/
  nginx-wenyuange.conf  # 站点 nginx 配置（含 PHP 段，部署时同步到服务器）
  api/feedback.php      # 反馈接收入口（部署到站点 /api/）
  admin-fdbk/index.php  # 反馈后台（部署到站点的随机路径下）
```

> **为什么把 CSS / JS 抽出来**（v1.3.0）：更新手记与反馈各自成页后，若各抄一份内联样式，
> 改一处颜色要改三处、必然改漏。抽出 `site.css` / `site.js` 是一次性成本，之后三个页面共进退。
>
> 抽取时踩过一个坑，值得记下：`site.css` 开头**多带了一行 `<style>`**（按行号切片时把标签行也切进去了）。
> 后果不是"样式全没了"，而是**只有第一条 `:root` 规则被整体丢弃** —— 变量全空，
> 于是所有 `var(--paper-2)` 之类的声明被浏览器逐条忽略。表现是"别的都好好的，就新加的输入框和按钮看不见"，
> 很容易误判成"新写的 CSS 有错"。**抽出样式表后先确认第一行不是 HTML 标签。**

> 下载区新增「校验下载到的是不是官方原版」折叠块（v1.2.5）：页面加载时读同目录的 `purity.json`，
> 列出安装包与关键程序文件的 SHA-256。读不到则显示兜底文案，不影响页面。
>
> **部署时注意**：这份 `purity.json` 必须用软件侧 `build-purity.cjs` 在**打包完成后**生成的那份
> （`dist-release/win-unpacked/resources/purity.json`），不要拿旧的。它与软件内嵌的清单
> **buildId 与指纹完全一致** —— 用户可以把官网上的编号和「设置 → 关于」里显示的对照。
> 若两份不一致，多半是部署时误用了旧清单，或清单没跟着新包一起上传。

## 构成手法

- **非对称首屏**：左文右册页（1.15 : 0.85），标题左侧立竖排小签。
- **中轴卷轴分隔**：「其 能 有 三」以两段细线夹标题排开。
- **档案栅格**：六张卡片共用 1px 缝线成账册感，编号 NO.01–06 作水印。
- **四角括号**：下载卡片四角朱砂直角，呼应线装封面。
- **氛围层**：纤维网格 + 噪点 + 三处淡色晕染（朱砂 / 竹青 / 石青）。

## 动效

| 场景 | 实现 |
|---|---|
| 入场序列 | `IntersectionObserver` 触发，`.rv` 错峰 90ms，共 3–6 组 |
| 卡片悬停 | 底纸变深 + 图标反白为朱砂 + 分类行左移 |
| 导航悬停 | 朱砂下划线由左向右扫过 |
| 终端光标 | 1.05s 步进闪烁 |
| 下载反馈 | 按钮状态机：正在取卷… → 已备妥 → 复原 |
| 降级 | `prefers-reduced-motion: reduce` 下全部关闭 |

## 内容结构

1. **首屏** — 竖排签 + 标题 + 册页分类（文 / 代 / 数 / 图 / 配 / 库）
2. **卷一 · 功能** — 六张档案卡（归类 / 解释器 / 连库 / 编目 / 多卷 / 代码补全）
3. **卷二 · 行文** — 竹简质感终端实景（末两条演示中文报错与 SQL 报错标位）
4. **卷三 · 取用** — 下载卡（**仅 Windows 版**，当前 v1.6.0；手机端额外出现提示行与「复制下载链接」；
   三条折叠说明：① 浏览器为什么提示「有风险」 ② 下载慢 / 断了怎么办 ③ 校验下载到的是不是官方原版）
5. **卷四 · 修订** — 更新手记（**主页只留最近三版** + 「查看全部修订」入口；历次修订全在 `journal.html`）
6. **卷五 · 问答** — 反馈页（`feedback.html`）
7. **页脚** — 功能 / 下载 / 更新手记 / 反馈（子页上是回主页的对应锚点）

> 已移除全部 GitHub 入口。

### 功能卡与真实功能的对应（改版前必须逐条核对）

官网写的功能必须与软件实际一致。v1.2.2 改版时核出三处不符，已修正：

| 卡片 | 依据 |
|---|---|
| 01 典籍归类 | 五十余格式预览/编辑、`Ctrl+F` 档案内查找（v1.2.0） |
| 02 解释器随选 | `RUN_SPECS` 二十余种语言；**报错汉化 + 行列定位**（v1.2.2） |
| 03 越洋连库 | `DRIVER_INFO` 是 **mysql / postgres / mssql / sqlite 四种** —— 原写「MongoDB」是错的；SSH 隧道 + SQL 报错标位 |
| 04 编目标签 | 印鉴标签、卷册、最近入档、检索直通文件正文 —— 原写「自定义文书关联与快捷处置」并不存在（多选批量只在 SQL 查询侧） |
| 05 多卷并陈 | 多标签、分屏对读、**作业模式**（v1.1.5） |
| 06 敲字即补 | 文本补全（v1.2.1）：关键字 / 内置名 / 对象成员 / 本文件词 + SQL 真表真列 —— 原「插件可扩」并无插件系统 |

## 手机端适配

断点：**1024**（平板横屏 · 首屏转单列）/ **820**（平板竖屏 · 卡片单列）/ **640**（手机 · 抽屉导航）/ **400**（小屏）/ **340**（极窄）。桌面 ≥1180 的版式一行未动。

- **顶栏**：手机上收成「印章 + 汉堡」。点开是贴顶抽屉（4 个锚点 + 下载按钮），带半透明遮罩；`Esc`、点遮罩、转回桌面宽度都会收起。展开时锁背景滚动，收起用**捕获阶段**先解锁、再让元素自身的平滑滚动跑（否则滚动会被 `overflow:hidden` 掐断）。
- **锚点偏移**：`section[id] { scroll-margin-top }`（桌面 92px / 手机 70px）——跳转后标题不再被吸顶栏压住。
- **触屏手感**：`@media (hover: none)` 把全部悬停态撤掉（手指点一下会"粘住"不散），换成 `:active` 按压反馈；`-webkit-tap-highlight-color: transparent` 去掉点击灰块。
- **尺寸**：手机断点重定义 `--sp-3 … --sp-8`，间距整体收缩；主标题 `clamp(34px, 10vw, 46px)`；页脚链接补到 42px 行高，可点元素一律 ≥ 40px。
- **长内容**：终端长命令不折行、整条可左右推（`overflow-x:auto` + `white-space:nowrap`）；手记里的 `code` 用 `inline-block + max-width:100%`——短标识符整词挪行，超长才在自己内部断。
- **手机专属件**（桌面一律 `display:none`，不影响原版式）：
  - `.mobile-tip` —— 手机端提示：文渊阁是 Windows 桌面应用，安装包须在电脑上跑；
  - `.dl-copy`「复制下载链接」—— 复制**安装包绝对地址**，方便传到电脑（`navigator.clipboard` 不可用时回退 `execCommand`）；
  - `.totop` 回到顶部 —— 滚动中淡到 26% 给正文让道，停手 320ms 恢复清晰；
  - `viewport-fit=cover` + `env(safe-area-inset-bottom)` 兜住全面屏底部；`theme-color` 跟随宣纸色。

### 验证

`shot-mobile.cjs [本地路径 或 https 网址] [输出目录]` —— Playwright 真实 Chromium 模拟 8 档设备（375 / 390 / 430 / 360 / 412 / 320 / 768 / 1440），逐台体检：

- 横向溢出（越界时列出具体元素）、顶栏形态、手机专属件显隐；
- 抽屉：展开 / 锁滚动 / 菜单项触摸高度 / 点项后收起并正确定位 / `Esc` / 点遮罩；
- 回到顶部出现与生效、复制链接反馈、**剪贴板内容 = 安装包绝对地址**（https 下）；
- 可点元素高度 ≥ 40px、主标题字号、册页卡与按钮自适应。

线上实测（bishe.xin）：**144 / 144 通过**；本地 138 / 138。截图落在 `docs-shot/mobile/`（本地）与 `docs-shot/mobile-online/`（线上）。

## 自检

- ✅ 展示字霞鹜文楷／思源宋体，均不在禁用清单
- ✅ 暖色宣纸底 + 单一朱砂强调色，非白底紫渐变
- ✅ 非对称构成、竖排签、破格角标
- ✅ 一次编排入场序列（90ms 错峰）+ 完整状态覆盖
- ✅ `prefers-reduced-motion` 降级已验证
- ✅ 语义标签：`header / main / section / article / aside / footer`，唯一 `h1`
- ✅ `:focus-visible` 朱砂描边 2px + 3px 偏移
- ✅ 触控目标：手机端实测无小于 40px 的可点元素；五档断点 340 / 400 / 640 / 820 / 1024px
- ✅ 手机端：抽屉导航 + 遮罩 + `Esc`、回到顶部、复制下载链接、全面屏安全区；8 档设备 0 横向溢出

---

## 部署信息

**线上地址**：http://8.208.113.137/

已部署至阿里云 ECS（宝塔 nginx 环境）：

| 项目 | 值 |
|---|---|
| 站点根目录 | `/www/wwwroot/wenyuange/` |
| 数据目录（**webroot 之外**） | `/www/wwwroot/wenyuange-data/`（属主 `www:www`，权限 750） |
| nginx 配置 | `/www/server/panel/vhost/nginx/wenyuange.conf` |
| 匹配方式 | `server_name 8.208.113.137`，用 IP 直访 |
| 当前安装包 | `DocBase-Setup-1.6.0.exe`（121,368,604 B / 115.7 MB，对应软件侧的 `文渊阁-安装程序-v1.6.0.exe`；构建编号 `WYG-202609221047-0EE68C`，指纹 `0A2D9BCB15988484`） |
| 配置备份 | `deploy/nginx-wenyuange.conf` |
| **服务器机房** | `eu-west-1`（阿里云**德国法兰克福**）· 实例 `ecs.e-c1m1.large` · 出网带宽上限 200 Mbps |

> 安装包的 MD5 / SHA-256 以站点根目录下的 **`purity.json`** 为准（页面上的校验码折叠块就是读它渲染的），
> 不再手抄到本文档里 —— 手抄必然会过期。软件侧 `build-purity.cjs` 生成的清单里就含 `md5` 字段。

站点目录内容：

```
/www/wwwroot/wenyuange/
├── index.html                  # 主页
├── journal.html                # 更新手记专页（历次修订全在这里）
├── feedback.html               # 反馈页
├── site.css  site.js           # 三页共用的样式与行为
├── purity.json                 # 校验清单（页面折叠块读它）
├── updates.json                # 更新清单（**客户端「自动更新」读它**，由 build-updates.cjs 从手记生成）
├── api/feedback.php            # 反馈接收入口
├── ops-XXXXXXXX/               # 反馈后台（网页版 index.php + 反馈台软件用的 api.php）
├── DocBase-Setup-1.6.0.exe     # 当前安装包（115.7 MB）
├── DocBase-Setup-1.5.2.exe     # 上一版
├── DocBase-Setup-1.5.1.exe     # 更早的版本
├── DocBase-Setup-1.5.0.exe     # 更早的版本
├── DocBase-Setup-1.4.1.exe     # 更早的版本
├── DocBase-Setup-1.4.0.exe     # 更早的版本
├── DocBase-Setup-1.3.3.exe     # 更早的版本
├── DocBase-Setup-1.3.2.exe     # 更早的版本
├── DocBase-Setup-1.3.0.exe     # 更早的版本
├── DocBase-Setup-1.2.7.exe     # 更早的版本
└── ...（旧版本一律保留，给缓存了旧页面的访客）

/www/wwwroot/wenyuange-data/     # ← 在站点根目录之外，公网取不到
├── config.php                  # 后台口令的 password_hash + 反馈台软件的口令 api_token（640 www:www）
├── feedback.jsonl              # 反馈正文，一行一条
└── ratelimit.json              # 按 IP 的限流记录
```

**更新页面**（改完前端后，一次传全）：

```bash
scp -i first.pem site.css site.js index.html journal.html feedback.html purity.json updates.json \
    root@8.208.113.137:/www/wwwroot/wenyuange/
ssh -i first.pem root@8.208.113.137 "nginx -s reload"
```

**更新安装包**：文件名必须与页面里的相对路径一致（`DocBase-Setup-X.Y.Z.exe`），
换版本时两边同步改名，否则下载按钮会 404。
上传后务必用 `md5sum` 与本地比对（115 MB 走公网，偶尔会传坏）：

```bash
scp -i first.pem 文渊阁-安装程序-vX.Y.Z.exe root@8.208.113.137:/www/wwwroot/wenyuange/DocBase-Setup-X.Y.Z.exe
ssh -i first.pem root@8.208.113.137 "md5sum /www/wwwroot/wenyuange/DocBase-Setup-X.Y.Z.exe"
```

**线上校验**（发版后都跑一遍）：

```bash
node probe-site.cjs https://bishe.xin/ --must 双击连接 --must 知识点小窗
node probe-feedback.cjs https://bishe.xin/      # 会自建再自删一条测试反馈
node shot-site.cjs                              # 骨架 + 截图 → docs-shot/
```

## 反馈（表单 → 接口 → 后台）

| 环节 | 位置 | 说明 |
|---|---|---|
| 表单 | `feedback.html` | 类型 / 标题 / 内容 / 称呼 / 邮箱；前端先挡空标题与过短内容；带蜜罐字段 `site` |
| 接口 | 站点 `/api/feedback.php` | 只收 POST+JSON；蜜罐命中则回「成功」但**不落库**；每 IP 限流（6/小时、30/天）；写入用 `flock` 独占 |
| 存储 | `/www/wwwroot/wenyuange-data/feedback.jsonl` | 一行一条 JSON；IP 只存哈希前 16 位 |
| 后台（网页） | 站点 `/ops-XXXXXXXX/` | 口令登录（`password_hash` 存 `config.php`）；可按类型/状态/关键词筛选、标记已处理、删除、导出 CSV |
| 后台（桌面软件） | 站点 `/ops-XXXXXXXX/api.php` | 「文渊阁·反馈台」用它取数。口令走 **`X-FB-Token` 请求头**（不放查询串，免得进 access log），口令是 `config.php` 里的 `api_token`。没口令或口令不对一律回 **404**，连"这里有个接口"都不承认 |
| 反馈台源码 | `../docbase-feedback/` | 独立小软件（Electron）。取数全在主进程做，渲染层只经 IPC 说话 —— 口令不进页面、也不进渲染层的网络栈 |

> **反馈台怎么发**：`cd ../docbase-feedback && node build-feedback.cjs`（依赖借 docbase-app 的
> node_modules，那里是 junction）。产物在 `docbase-feedback/dist-release/`。
> 它**不对外发布** —— 是自用工具；源码与安装包都留在本机。要换口令只改服务器上的
> `config.php` 的 `api_token`，软件里 `设置` 跟着改一次即可，服务端代码不用动。

> **PHP 是怎么接进来的**：宝塔的站点配置默认只写了 `location /`，`.php` 不会被交给 php-fpm。
> 本站在 `wenyuange.conf` 里为 `/api/` 与后台路径各加了一段 `include enable-php-82.conf;`
> （php-fpm 走 `unix:/tmp/php-cgi-82.sock`），并另加 `location ~ /\. { deny all; }` 挡点文件。
>
> 两个部署时踩到的坑：
> 1. **数据目录属主**：一开始是 `root:root 0700`，而 php-fpm 以 `www` 运行 → 写入失败，
>    接口回「写入失败，请稍后再试」。必须 `chown -R www:www` 且 `chmod 750`。
> 2. **后台 403**：站点级的 `index` 只写了 `index.html`，而后台目录里是 `index.php`，
>    访问 `/ops-XXXXXXXX/` 会因目录索引被禁而 403。要在该 location 里补 `index index.php;`。

## 默认导出路径（v1.5.1）

导出档案与数据库表统一收口到一个出口：**主进程直写磁盘**，目录由偏好 `exportDir` 决定（设置 → 存储 → 默认导出路径）。

| 项 | 说明 |
|---|---|
| 存哪 | `settings.json` 的 `prefs.exportDir`（**白名单**：`publicPrefs()` 与 `POST /api/prefs` 两边都要认） |
| 选目录 | 主进程 IPC `db:pick-dir`（`dialog.showOpenDialog`），桥上的 `docbaseNative.pickDir` |
| 导出出口 | `exportViaNative(url, fallbackName)`：取回字节 → `saveFile({ name, base64, dir })`，档案与数据表共用 |
| 留空 | 回落到 `app.getPath("downloads")`；目录不存在时主进程 `mkdirSync(recursive)` 自动建 |
| 校验口径 | 只存字符串（≤400 字），**不要求路径此刻存在** —— 用户可能先填好、回头再插盘；写盘那一刻失败会明确报错 |
| 写偏了会怎样 | 若实际落点与默认路径不一致，界面额外给一条 warn 提示，不悄悄换个地方存 |
| 测试 | `smoke-prefs.cjs`（11 条：存/读/清除/超长/非字符串/纯空白/不存在也存）+ `probe-v151-issues.cjs`（16 条，含真机导出落盘） |

> 为什么档案导出原来落不进指定目录：它走的是 `location.href`，由 Chromium 的下载子系统接管，只能进浏览器下载目录。
> 改成 IPC 直写之后，「默认导出路径」才真的管得着 —— 这也是这次一并改掉的地方。

## 代码高亮与 HTML 预览（v1.6.0）

### 编辑区语法高亮走的是「叠加层」

代码档案、SQL 查询框、工程文件用的都是原生 `<textarea>`，而 **textarea 内部的文字没法着色**
（DOM 里只有一个文本节点，浏览器不给地方挂 span —— 应用里做查找高亮时已经踩过：CSS Custom Highlight API
对 textarea 只能退回原生选区）。换成 Monaco / CodeMirror 要动整条编辑链路：保存、草稿、补全、字号缩放、查找全得跟着改。

所以 `public/highlight.js` 叠了一层：底下 `<pre class="hl-layer">` 负责上色，textarea 文字透明、只留光标，
两层同字号同内边距（`mirrorStyle` 从计算样式逐项复制）与同折行方式，输入 / 滚动 / 宽度变化时同步。
词表**借 autocomplete.js 的**（`window.wygLex`）—— 两套词表必然各改各的，颜色和补全迟早对不上。

| 约束 | 值 | 为什么 |
|---|---|---|
| 上色上限 | 200 KB | 再大全量重排会明显卡手，宁可回到纯文本 |
| 输入节流 | 120 ms | 每次按键都重扫会卡 |
| 对齐判据 | 两层 `scrollHeight` 差 ≤ 4px | 差一个像素都会整体错位，这是最直接的证据（`probe-v160` 盯着它） |

### HTML 档案：真预览 + 附属文件

| 项 | 说明 |
|---|---|
| 预览 | `extractPreview` 给 `.html`/.htm/`.xhtml` 单独一个分支（原来它归 code 类，被 isPlainText 兜底成一段转义源码）。前端用 `iframe srcdoc` 渲染 |
| 外链资源 | 档案可带**附属文件**（`DATA_DIR/assets/<docId>/`）。预览时给 iframe 注入 `<base href="/api/documents/<id>/asset/">` —— 档案里照常写 `style.css`、`img/logo.png`，相对路径自然落回自己的附属文件，**HTML 一个字都不用改写** |
| 脚本 | iframe **默认不给 `allow-scripts`**（页面脚本不跑）。`allow-scripts` + `allow-same-origin` 等于让页面脚本能碰应用本身 |
| 读文件的路由 | 走**前缀匹配**而不是路由表 —— 附属文件名可能带子目录（`css/style.css`），而路由是按 `/` 分段比对的，多一段就落空 |
| 边看边改 | 预览与编辑装进同一个横向容器 `#editWatch`（两者本来就是同级兄弟、靠 hidden 互斥），编辑标签下左右分栏，工具条上可关 |

## 发布流程为什么曾经「卡在最后一步」（v1.5.2 排查）

症状：发版的最后一步（跑真机探针 / 线上校验）常常十几分钟没有任何输出。

实测排除了网络：首页与静态资源 1 秒级、`probe-site` 36 秒、`probe-feedback` 9 秒、
scp 上传 121 MB 约 95 秒 —— 都不该是十几分钟。真正的原因是**机器上堆着一批「早就卡死却还活着」的探针进程**
（一次实测抓到 6 个，分别挂了 195 / 157 / 125 / 93 / 92 / 25 分钟）：它们的断言早已跑完、
结果也写进日志了，**进程却永不退出**，而发布脚本在串行等它们。

三个叠加的机制（都会在 `MEMORY.md` 里）：

| 机制 | 表现 | 修法 |
|---|---|---|
| `await browser.close()` 在 CDP 模式下**可能永不返回** | 它包在 `try/catch` 里，而 catch 只接得住「抛异常」、接不住「永不返回」 | `Promise.race([close(), sleep(3000)])` + 脚本级看门狗（到点 `process.exit(9)`） |
| `taskkill /F /IM 文渊阁.exe` **按镜像名杀** | 会关掉**用户自己开着的软件**；并发探针互相杀，被杀的卡在等 CDP 上 | 改成 `/F /T /PID <自己 spawn 的 pid>`，只收自己那棵树 |
| `NODE_OPTIONS` 里的 `genie-safe-delete` 垫片让 **fs 删除慢约 50 倍** | 收尾删整个 Chromium 配置目录时卡几分钟到十几分钟 | 脚本**自愈**：检测到垫片就带干净环境重跑自己 |

实测：同一个探针从「挂 8 分钟」变成 **21 秒**；全量回归从十几分钟变成 **3 分 46 秒**。

配套两个小工具：
- `clean-stuck.cjs`（在 `docbase-app/`）—— 一键列出并清掉跑超过 6 分钟还在挂着的探针进程，`--dry` 只看不动
- `diag-close.cjs` —— 把「收尾」拆开逐步计时，一次说清卡在哪一步

另外：每次打包会在 `%TEMP%` 留下约 400 MB 的 `wyg_build_*`，日积月累曾堆到 **13.5 GB**
（31 个旧构建 + 117 个探针 profile），会被 Defender 与索引服务反复扫、拖慢一切 —— 现在发版后顺手清。

## 多文件编程工程（v1.5.0）

一个工程 = 数据目录里 **`projects/<id>/` 一个真实目录** + `db.json` 里一条元信息（`projects[]`）。
不做成「多个档案拼一个工程」的原因：scrapy 这类项目靠目录结构与包名做相对导入
（`from myproject.items import X`），摊平成几个独立档案就废了；而且档案正文会被版本化重命名
（`<uid>-v.py`），文件名与真实工程对不上。

| 项 | 说明 |
|---|---|
| 模块 | `projects.cjs`（路由挂接；界面是档案目录的「＋ 工程」按钮与工程视图） |
| 模板 | `blank` / `py` / `scrapy`（scrapy 会铺 scrapy.cfg + 包目录 + spiders/example.py + requirements.txt） |
| 命令 | 每个工程可存多条（名字 + 命令）；**cwd = 工程根** —— scrapy 靠这个找 scrapy.cfg |
| 依赖 | 装进工程的 `.packages`（`PIP_TARGET`），运行/终端都注入 `PYTHONPATH`，不动系统 Python |
| 安全 | 所有带 `path` 的接口都过 `safeJoin`：规范化后必须仍在工程目录内（挡 `../`、绝对路径、盘符写法） |
| 写盘 | 原子替换（先写 `.wyg-tmp` 再 rename），写一半断电不毁原文件 |
| 测试 | `smoke-projects.cjs`（40 条：路径守卫 5 条、cwd、PIP_TARGET、模板结构、原子写…）+ `probe-v150-issues.cjs` 真机全流程 |

> 命令里的引号：Windows 上用 cmd 跑命令时**必须显式包一层引号并设 `windowsVerbatimArguments`**，
> 否则 Node 会把参数再转义一次、在第一个内层引号处就断 —— `python -c "print(1)"` 这类会静默失败。
> 工程的跑命令与内置终端都已按这个写法修好。

## 草稿箱（v1.4.1）

编辑区里写一半就把软件关了（甚至断电、在任务管理器里结束进程），内容不会丢。

| 项 | 说明 |
|---|---|
| 存哪 | 数据目录的 `drafts.json`，由 `drafts.cjs` 管理 |
| 怎么写 | **同步 + 原子替换**（先写 `.tmp` 再 `rename`）。草稿的意义就是「下一秒可能断电」，所以既不做防抖也不异步写 —— 渲染层每 1.2 秒攒一次，服务端一次落一条，断电时要么旧要么新、不会是半截 JSON（`smoke-drafts.cjs` 里有一条「写完就强杀进程」的测试盯着） |
| 上限 | 单份正文 512 KB、最多 200 份，超出按更新时间淘汰最旧的；key 里的非安全字符会被压成 `_`（它要进 URL） |
| 覆盖范围 | SQL 查询、档案正文修订（`#drawerEdit`）、作业面板、以及 `editor.js` 的富文本 / 表格 / 导图 / 文稿 / 演示五个形态 |
| 内容清空 | 视为撤回（不留一份空草稿让人以为有东西） |
| 恢复方式 | 查询：连上连接时自动回到页签（最多 8 份）；其余编辑面：打开时在编辑区上方给一条**「恢复 / 丢弃」**提示条 —— 刻意不做「悄悄填回去」，那会在用户没注意时盖掉刚写的东西 |
| 什么时候删 | 正式保存成功后自动删；用户点「丢弃」也删 |
| 不加密 | 和 `db.json` 一样躺在你的数据目录里 |

> 查询还有一处专门的入口：对象树「查询」下的 **「草稿（未保存）」** 文件夹（右键可「存为正式查询 / 丢弃」）。
> 那个文件夹是**渲染时注入**的（`drTreeInjectRaw()` 挂在 `renderDbTree` 开头），不落进服务端返回的树数据里。

## 客户端自动更新（v1.4.0）

客户端启动后会拉一次 `https://bishe.xin/updates.json`，与自己的版本比；有新版就列出
**比它当前版本新的那几版**说明，点「下载并安装」才下载、校验、静默安装并重启。

**每发一版必须重新生成并上传 `updates.json`**，否则客户端永远看不到这一版：

```bash
node build-updates.cjs          # 读 journal.html + purity.json → 写 updates.json
scp -i first.pem updates.json root@8.208.113.137:/www/wwwroot/wenyuange/
```

| 项 | 说明 |
|---|---|
| 版本说明从哪来 | **从 `journal.html` 解析**（版本号 / 中文日期 / 每条 `<li>`）。手记与清单是同一件事，分开维护必然出现「手记写了、清单忘了」 |
| 当前版本从哪来 | `purity.json`（版本、体积、sha256）。**清单里没有 sha256 就直接中止生成** —— 客户端拒绝安装没有校验码的更新包 |
| 为什么先补手记 | 生成脚本发现手记里没有当前版本的条目会中止：否则用户点更新时看到的说明会缺最新一版 |
| 客户端侧的硬规矩 | 只认 https + `bishe.xin`；安装包 sha256 与清单不一致一律丢弃；**安装**这个动作在主进程做，且只允许执行 `dataDir/updates` 下的 `.exe`（本地 HTTP 面没有起进程的能力） |
| 不打扰 | 「稍后」过的版本记在 `prefs.updSkip` 里，不再每次启动都弹；同日只出网一次（`?force=1` 强制重查）；出网失败保留上次成功结果，不假装「已是最新」 |

## 更新手记（独立页）

`journal.html` 内 `<ol class="journal">` 为「第 四 卷 · 修订」更新日志，
样式类 `.journal / .jr-item / .jr-ver / .jr-date / .jr-tag(.fix|.new|.imp) / .jr-list`。
每次发版在 `<ol class="journal">` 顶部插入一条 `<li class="jr-item latest">`，
并把上一条的 `latest` 去掉（`latest` 只给最新版，版本号与圆点走朱砂色）。

**主页只保留最近三版**（`index.html` 的 `#journal` 里同样三条），并挂一个「查看全部修订 →」指向 `journal.html`。
两条内容重复，改文案时**两处都要改** —— `probe-site.cjs` 会分别核对主页三条与专页全量。

子页上的顶部导航 / 抽屉导航 / 页脚都指向 `index.html#volume` 这类**跨页锚点**，
不要留 `href="#volume"`：那在子页上没有对应区块，点了什么也不会发生（探针里有一条专门查这个）。


> 该配置为独立 server block，不影响服务器上已有的 `5325.tech` 站点。

---

## 域名与 SSL

**正式地址**：https://bishe.xin/ （www 同样可达）

| 项目 | 值 |
|---|---|
| 域名 | `bishe.xin`、`www.bishe.xin`（均已 A 记录指向 8.208.113.137） |
| 证书类型 | Let's Encrypt，RSA 2048，含两个域名 |
| 证书路径 | `/www/server/panel/vhost/cert/bishe.xin/{fullchain.pem,privkey.pem}` |
| 签发工具 | acme.sh（`/root/.acme.sh/acme.sh`），webroot 模式 |
| 自动续期 | 已配置，首次续期约 2026-11-19（续期后自动 reload nginx） |

三段式 server 配置：

1. **80 + 域名** → 仅保留 ACME 验证路径，其余 301 跳转到 HTTPS
2. **80 + IP** → 保留 HTTP 直访（IP 不在证书内，跳转会导致证书告警）
3. **443 + 域名** → SSL 站点，TLS 1.2/1.3、HTTP/2、HSTS

**手动续期 / 重新签发**：

```bash
/root/.acme.sh/acme.sh --issue -d bishe.xin -d www.bishe.xin \
  --webroot /www/wwwroot/wenyuange --server letsencrypt --keylength 2048

/root/.acme.sh/acme.sh --install-cert -d bishe.xin \
  --key-file       /www/server/panel/vhost/cert/bishe.xin/privkey.pem \
  --fullchain-file /www/server/panel/vhost/cert/bishe.xin/fullchain.pem \
  --reloadcmd      "nginx -s reload"
```

> 注意：配了 HSTS（`max-age=31536000`），浏览器会在一年内强制走 HTTPS。
> 若日后要退回纯 HTTP，需先从 nginx 移除该响应头，再在浏览器清除 HSTS 记录。
