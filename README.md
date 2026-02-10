# Deep Image Compression to AVIF

[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-Image--Resize-blue?logo=github)](https://github.com/RainPPR/action-image-resize)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

这是一个专为 Markdown 文档仓库设计的 GitHub Action，旨在通过深度压缩将图片转换为现代的 **AVIF** 格式。它不仅能显著减少图片体积，还能自动更新 Markdown 文件中的图片引用，非常适合追求极致加载速度的个人博客或静态文档项目。

## ✨ 特性

- **全自动化转换**：自动扫描指定目录（默认为全仓库）中的 `png`, `jpg`, `jpeg`, `webp` 图片，并支持 `svg` 的极限压缩。
- **极致压缩**：位图使用 [Sharp](https://sharp.pixelplumbing.com/) 转换为 `avif`（质量 `60`）；矢量图使用 [SVGO](https://github.com/svg/svgo) 进行多轮重复扫描及浮点精度（`1.0`）极限压缩。
- **智能缩放**：如果图片宽度超过 `2560px`，将自动等比缩放至 `2560px` 宽度。
- **引用同步**：自动查找并替换 `.md` 文件中的图片扩展名，保持文档链接有效。
- **运行报告**：自动生成压缩总结信息，可用于 PR 评论或 Job Summary。
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
        id: compress_step  # 设置 ID 以便获取输出
        uses: RainPPR/action-image-resize@main
        with:
          path: '.'

      - name: Update PR Body
        if: github.event_name == 'pull_request'
        uses: mshick/add-pr-comment@v2
        with:
          message: |
            ${{ steps.compress_step.outputs.summary }}
          # 或者如果你想使用环境变量：
          # message: ${{ env.IMAGE_COMPRESSION_SUMMARY }}

      - name: Commit & Push changes
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: compress images and update links"
```

## 📊 压缩总结报告

本 Action 会生成一份 Markdown 格式的详细报告。你可以按照以下两种方式使用它：

### 1. 作为 Step Output

通过设置步骤 `id`，使用 `${{ steps.<id>.outputs.summary }}` 获取。

### 2. 作为 环境变量

Action 会自动设置名为 `IMAGE_COMPRESSION_SUMMARY` 的环境变量。你可以直接在脚本或后续步骤中使用 `${{ env.IMAGE_COMPRESSION_SUMMARY }}`。

**在 PR Body 中使用的示例：**
如果你想在 PR 开启时自动将报告内容评论到 PR 中，可以参考上面的示例 Workflow。

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
