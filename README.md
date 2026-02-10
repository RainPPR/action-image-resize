# Action Image Resize 🚀

[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-Image--Resize-blue?logo=github)](https://github.com/RainPPR/action-image-resize)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

这是一个为 **Markdown 文档仓库** 量身定做的深度图片压缩与自动化管理方案。通过 GitHub Action，本工具能自动将位图转换为现代的 **AVIF** 格式，并对 SVG 进行极限优化，同时自动同步修复所有 Markdown 引用路径。

---

## 🎯 应用场景与局限性

在决定使用本项目前，请务必阅读以下说明：

### **推荐场景**

- **个人博客/技术文档**：追求加载速度的极致优化。
- **静态资源托管**：希望在保证视觉效果的前提下最大化节省存储和 CDN 流量。

### **不推荐场景**

- ❌ **摄影或高保真作品集**：本项目默认采用 `avif` 质量 `60` 且会强制对超大图进行缩放，不适合对图像细节有严苛要求的场景。
- ❌ **兼容性要求极高**：AVIF 在极旧设备或浏览器上可能无法渲染（建议环境：Chrome 120+）。
- ❌ **高频率重复运行**：**警告**：本工具会对 SVG 进行多次扫描重复压缩。频繁对同一批存量图片运行会浪费计算资源，且可能导致 SVG 精度在多次重采样中受损。请合理配置触发路径。

> [!WARNING]
> 如果图片路径中有空格，可能会出现错误，请先检查是否存在这类问题，修复后再运行本脚本，或者运行后再手动检查修复。

---

## ✨ 核心特性

- **位图全自动转码**：自动扫描 `png`, `jpg`, `jpeg`, `webp`, `gif` 并转换为 `avif` 格式。
- **矢量图动态处理**：
  - **> 30KB**：自动转换为 `avif` 格式（2.5 倍缩放，增强清晰度）。
  - **<= 30KB**：基于 [SVGO](https://github.com/svg/svgo) 进行多轮重复扫描，针对现代显示屏优化浮点精度（`2.0`），保持矢量格式的同时极致精简代码。
- **智能缩放策略**：图片宽度上限限制在 `2560px`，超宽图片将自动等比缩小。
- **引用同步修复**：自动更新 `.md` 文件中的图片后缀，避免手动修改链接的烦恼。
- **透明化报告**：运行结束后生成详细的压缩数据报告（支持 Job Summary 和环境变量）。
- **开箱即用**：基于 Docker (`node:slim`)，无需污染宿主环境。

---

## 🚀 快速上手

在你的 GitHub 仓库中创建 `.github/workflows/image-compress.yml`：

```yaml
name: Image Compression

on:
  push:
    branches: [ main ]
    paths:
      - '**.png'
      - '**.jpg'
      - '**.jpeg'
      - '**.webp'
      - '**.gif'
      - '**.svg'
  workflow_dispatch:

jobs:
  compress:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Compress Assets
        id: compress_step
        uses: RainPPR/action-image-resize@main
        with:
          # 可选：指定处理目录，例如 'docs'。默认处理全仓库。
          path: '.'

      - name: Add PR Summary
        if: github.event_name == 'pull_request'
        uses: mshick/add-pr-comment@v2
        with:
          message: |
            ${{ steps.compress_step.outputs.summary }}

      - name: Commit & Push changes
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: optimize images and update markdown links"
```

---

## � 输入与输出

### **Inputs**

| 参数 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `path` | 指定要处理的子目录（相对于根目录） | `.` |

### **Outputs**

| 参数 | 说明 |
| :--- | :--- |
| `summary` | 包含 Markdown 格式的压缩总结报告 |

### **Environment Variables**

本 Action 会自动注入环境变量 `IMAGE_COMPRESSION_SUMMARY`，内容同 `summary` 输出，方便在后续步骤中直接引用。

---

## 🛠️ 技术原理

1. **扫描阶段**：递归检索指定目录下的位图与 SVG 文件。
2. **Sharp 转码**：
   - 检查宽度，若 > 2560 则进行 `resize` 处理。
   - 转换为 `avif` 格式（质量 60），删除原图。
3. **SVG 处理**：
   - 体积 **> 20KB**：使用 Sharp 渲染并转换为 `avif`（2.5x 采样，最大宽度 2560px）。
   - 体积 **<= 20KB**：执行 SVGO `multipass` 多轮优化，清理元数据及冗余样式。
4. **路径同步**：基于实际结果更新路径。只有当本地图片被转换为 `.avif` 后，Markdown 中对应的引用才会更新，确保不会误改未变动的 SVG 引用。

---

## ⚠️ 注意事项

- **原地修改**：本工具会直接修改/删除工作区文件。**请务必配合 Git 提交逻辑使用**。
- **SVG 损耗**：极限压缩后的 SVG 浮点数精度为 1~2 位，在常规显示器下无感，但请勿用于高精度矢量编辑源文件。

---

## 🤝 贡献与反馈

本项目由开发者 `RainPPR` 独立维护。

- **现状说明**：由于个人精力和项目定位原因，本项目旨在解决特定需求。**暂不接受**大规模的功能增强请求（Feature Request）。
- **欢迎反馈**：如果您在使用中发现了 Bug、打字稿错误或是更好的优化思路，非常欢迎提交 Issue 或 Pull Request，我将不胜荣幸。

---

## 📄 许可证

基于 [MIT License](LICENSE) 许可协议。

---

> [!NOTE]
> 本文件由 **Antigravity (Gemini 3 Flash)** 生成，并由 **RainPPR** 进行了人工验收与微调。
