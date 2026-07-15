<div align="center" >
<img style="display: block; margin: 0 auto; " src="./src/assets/logo.png" width="200" height="200" />
</div>

<h1 align="center">豆包下载器 Plus</h1>
<p align="center">豆包 / Dola AI 无水印资源批量下载 + 15秒视频生成油猴脚本</p>

<div align="center">

<img alt="GitHub Release" src="https://img.shields.io/github/v/release/Luncot/doubao-downloader-plus?style=for-the-badge">
<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/Luncot/doubao-downloader-plus?style=for-the-badge">

</div>

## ✨ 功能

- **🖼️ 图片无水印批量下载** — 自动捕获对话中的无水印原图，面板管理，一键打包 ZIP
- **🎬 视频无水印下载** — 每个视频上叠加下载按钮，3 层 API 保障 + `lr=` 水印参数替换
- **⏱️ 15秒视频生成** — 右下角 `15s ON/OFF` 悬浮开关，`JSON.stringify` 注入 `duration=15`
- **📋 对话筛选** — 按对话分类查看图片/视频，全量扫描历史
- **🌍 国际版支持** — 同时支持 `doubao.com`（国内）和 `dola.com`（国际）
- **⚙️ 设置面板** — 自定义文件名、下载并发数、跳过已下载等

## 📦 安装

### 油猴脚本（推荐）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 前往 [Releases](https://github.com/Luncot/doubao-downloader-plus/releases/latest) 下载 `doubao-downloader.user.js`
3. 拖入浏览器自动安装

### 手动构建

```shell
git clone https://github.com/Luncot/doubao-downloader-plus.git
cd doubao-downloader-plus
npm install
npm run build
```

构建产物在 `dist/` 目录。

## 🚀 使用

| 操作 | 方式 |
|------|------|
| 下载图片 | 点击右侧豆包头像打开面板 → 勾选 → 下载 |
| 下载视频 | 点击视频上 `⬇️ 下载视频` 按钮 |
| 开启15秒 | 点右下角 `15s OFF` 变成 `15s ON` |
| 设置 | 面板右上角 ⚙️ 按钮 |

所有功能免费，无需激活码。

## 🔧 技术原理

| 功能 | 原理 |
|------|------|
| 图片去水印 | 拦截 `JSON.parse`，提取 `image_ori_raw.url` |
| 视频去水印 | `get_download_info` / `get_play_info` / `share_save` 三层 API + `lr=` 替换 |
| 15秒视频 | hook `JSON.stringify`，注入 `duration=15` |
| 视频按钮 | MutationObserver 扫描 `<video>` 标签，挂载下载按钮 |

## 📄 License

GNU General Public License v3.0

基于 [doubao-downloader](https://github.com/LauZzL/doubao-downloader) (GPL-3.0) 修改。
