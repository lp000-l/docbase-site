# 文渊阁 DocBase · 官网镜像（GitHub Pages）

本站是 **文渊阁（DocBase）** 官网的 **GitHub Pages 镜像**，内容由发布脚本自动生成，请勿手动修改本仓库。

- **正式站点**：<https://bishe.xin/>
- **本站（镜像）**：<{{PAGES_URL}}>
- **当前版本**：`{{VERSION}}`（{{UPDATED}} 更新）

## 这是什么

文渊阁是一个 Windows 单机知识库软件：文档 / 表格 / PPT / PDF / 图片统一管理，可预览编辑、
可直接运行代码（Python / JavaScript / SQL 等）、支持 .ipynb 笔记本，并能导出多种格式。
详见正式站点的[功能说明]({{PAGES_URL}}#volume)。

本镜像提供两条通路：

1. **网页**（Pages）——主页、更新手记、便携版说明、反馈页。域名不可用时的备用浏览入口。
2. **安装包 / 便携包**（Releases）——见下方下载表，与正式站点发布的是**同一份文件**（同一 sha256）。

## 下载

| 版本 | 说明 | 文件 |
|---|---|---|
| 安装版 `{{VERSION}}` | 双击安装，自动更新 | [Releases]({{RELEASES_URL}}/latest) · `DocBase-Setup-{{VERSION}}.exe` |
| 便携版 `{{VERSION}}` | 解压即用 · 自带 Python · 资料跟着 U 盘走 | [Releases]({{RELEASES_URL}}/latest) · `DocBase-Portable-{{VERSION}}.zip` |

- 安装版会自动检查更新（读正式站点的 `updates.json`）。
- 便携版**不参与自动更新**，升级请换一个新的便携包。
- 校验码（SHA-256）在正式站点的下载区与[便携版专页]({{PAGES_URL}}portable.html)都有列出。

## 页面清单

| 文件 | 内容 |
|---|---|
| `index.html` | 主页：功能、下载、最近三版更新手记 |
| `journal.html` | 更新手记全量 |
| `portable.html` | 便携版专页（是什么 / 怎么用 / 自带环境 / 与安装版的区别） |
| `feedback.html` | 反馈与建议（表单提交到正式站点的接口） |
| `purity.json` | 安装版的构建清单（版本、构建号、逐文件哈希） |
| `portable.json` | 便携版的清单（文件名、体积、sha256、md5） |
| `updates.json` | 更新说明（客户端自动更新读的就是它） |

## 本镜像与正式站点的差别

- **反馈表单**：表单仍提交到正式站点的接口（`https://bishe.xin/api/feedback.php`），
  所以反馈会进同一个后台，不会因为走镜像而丢失。
- **下载按钮**：镜像上指向本仓库的 Releases，正式站点上指向服务器上的同一个文件。
- **内容一致性**：页面由同一个发布脚本从同一份源文件生成，`probe-mirror.cjs` 会逐项比对
  （校验码、下载卡元信息、四节内容、无死链、无 JS 报错）。

## 怎么更新

不要在 GitHub 上直接改。发布新版本时，在开发机的 `docbase-website/` 目录里跑：

```bash
GITHUB_TOKEN=<你的 token> node gh-publish.cjs
```

它会：组装静态站 → 推到本仓库 → 建好对应的 Release 并上传安装包与便携包 → 打印校验结果。
脚本**不会**把 token 写进任何文件或 git 配置。

---

文渊阁 DocBase · 由发布脚本自动生成，勿手改。
