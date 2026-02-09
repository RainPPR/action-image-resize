# Deep Image Compression to AVIF

[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-Image--Resize-blue?logo=github)](https://github.com/RainPPR/action-image-resize)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

这是一个专为 Markdown 文档仓库设计的 GitHub Action，旨在通过深度压缩将图片转换为现代的 **AVIF** 格式。它不仅能显著减少图片体积，还能自动更新 Markdown 文件中的图片引用，非常适合追求极致加载速度的个人博客或静态文档项目。

## ✨ 特性

- **全自动化转换**：自动扫描指定目录（默认为全仓库）中的 `png`, `jpg`, `jpeg`, `webp` 图片并转换为 `avif`。
- **极致压缩**：使用 [Sharp](https://sharp.pixelplumbing.com/) 引擎，默认质量设为 `60`。
- **智能缩放**：如果图片宽度超过 `2560px`，将自动等比缩放至 `2560px` 宽度。
- **引用同步**：自动查找并替换 `.md` 文件中的图片扩展名，保持文档链接有效。
- **Docker 驱动**：基于 Docker 运行，无需在 Runner 环境中安装额外的 Node.js 或原生库。

## 🚀 快速上手

在你的 GitHub 仓库中创建 `.github/workflows/image-compress.yml` 文件：

```yaml
name: Image Compression

on:
  push:
    branches:
      - main
    paths:
      - '**.png'
      - '**.jpg'
      - '**.jpeg'
      - '**.webp'
  workflow_dispatch:

jobs:
  compress:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Compress Images to AVIF
        uses: RainPPR/action-image-resize@main
        with:
          # 可选：指定处理目录，例如 'docs'。如果不传则处理整个仓库。
          path: '.'

      - name: Commit & Push changes
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: compress images to avif and update md links"
```

## 🛠️ 技术细节

### 处理逻辑

1. **遍历文件**：递归查找所有非 `avif` 和 `svg` 的位图文件。
2. **Sharp 转换**：
   - 检查宽度，若 > 2560 则进行 `resize`。
   - 转换为 `avif` 格式，质量参数定为 `60`。
3. **清理工作**：转换完成后删除原始的位图文件。
4. **文档更新**：使用正则表达式匹配并更新项目内所有 `.md` 文件中的图片链接。

### 为什么选择 AVIF？

AVIF 是目前最先进的图像格式之一，相比 WebP 或 JPEG，它在同等画质下拥有更小的文件体积。虽然它对非常古老的浏览器支持不足，但对于现代 Web 应用和文档站来说是极佳的选择。

## ⚠️ 注意事项

- 本工具会**直接修改**工作区文件（转换为 avif 并删除原图），请务必配合 `git-auto-commit-action` 或手动 commit 逻辑使用。
- 建议仅在非二进制、纯 Markdown 文档仓库中使用，或者确保你有良好的 Git 备份。

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。

---

> [!NOTE]
> 本项目由 **人工智能 (Antigravity/Gemini 2.0 Flash)** 生成，并经过人工（RainPPR）通过验收和微调。由于开发者精力有限，本项目暂不接受大规模的功能性添加建议，但非常欢迎任何形式的 Bug 修复或文档改进建议。
