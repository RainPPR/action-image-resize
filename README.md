# action-image-resize

[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-image--resize-blue?logo=github-actions&logoColor=white)](https://github.com/RainPPR/action-image-resize)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Runtime-Docker%20node%3Aslim-informational?logo=docker)](https://hub.docker.com/_/node)

一个为 **Markdown 文档仓库**量身定做的图片自动压缩 GitHub Action。

它能将 PNG、JPG 等位图全自动转换为现代的 **AVIF** 格式，对 SVG 应用智能分级优化策略，并在转换后**自动同步所有 Markdown 中的图片引用路径**，让你无需任何手动操作。

---

## 目录

- [适用场景](#适用场景)
- [核心特性](#核心特性)
- [快速上手](#快速上手)
- [输入与输出](#输入与输出)
- [工作原理](#工作原理)
- [注意事项](#注意事项)
- [贡献与反馈](#贡献与反馈)
- [许可证](#许可证)

---

## 适用场景

### ✅ 推荐场景

- **个人博客 / 技术文档仓库**：追求页面加载速度的极致优化。
- **静态资源托管**：希望在保证视觉效果的前提下，最大化节省存储和 CDN 流量。

### ❌ 不推荐场景

- **摄影或高保真作品集**：本 Action 默认使用 AVIF 质量 `60`，且会对宽度超过 `2560px` 的图片强制缩放，不适合对图像细节有严苛要求的场景。
- **兼容性要求极高的项目**：AVIF 在极旧的设备或浏览器（早于 Chrome 85 / Safari 16）上可能无法正常渲染。
- **高频率重复运行**：本工具对图片执行**原地**、**不可逆**的替换。对同一批存量图片重复运行会产生无意义的 CI 消耗，且 SVG 的 SVGO 优化在多次迭代后可能造成精度损失。**请通过精准的 `paths` 过滤器控制触发条件**。

> [!WARNING]
> 本 Action 会**直接删除原始图片**并写入转换结果，属于破坏性操作。请务必配合 Git 提交步骤使用，确保变更可追溯和回滚。

---

## 核心特性

- **位图全自动转码**  
  扫描 `.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`，全部转换为 AVIF 格式，原文件自动删除。

- **AVIF 文件名含内容哈希**  
  转换后的 AVIF 文件名中会嵌入内容 SHA-256 的后 7 位（如 `image-1-a3f8c2d.avif`），有效防止同目录下不同原始文件（如 `image-1.png` 与 `image-1.svg`）转换后产生命名冲突。

- **SVG 智能分级处理**  
  根据文件大小及内容特征，对 SVG 采取不同策略：

  | 条件 | 处理方式 |
  | :--- | :--- |
  | 体积 ≥ 100 KB | 强制转为 AVIF |
  | 体积 40–100 KB 且含内联位图/字体 | 强制转为 AVIF |
  | 体积 10–100 KB（其他） | 试转：若 AVIF 体积 < 原体积 × 0.5（≥40KB）或 × 0.2（<40KB）则保留，否则回退 |
  | 其他（未转换的 SVG） | 使用 [SVGO](https://github.com/svg/svgo) 进行 `multipass` 极限优化 |

- **超宽图片限制**  
  位图宽度超过 `2560px` 时，自动等比缩放至 `2560px`；SVG 转 AVIF 时目标宽度上限为 `1080px`。

- **Markdown 引用自动同步**  
  处理完成后，自动扫描目录下所有 `.md` 文件，将其中指向被转换图片的引用路径（支持 `![](...)` 语法和 `<img src="...">` 标签）同步更新为新的 AVIF 路径（含哈希）。

- **透明化压缩报告**  
  运行结束后自动生成 Markdown 格式的摘要，可输出到 GitHub Job Summary、PR 评论及后续步骤的环境变量。

- **开箱即用，零依赖污染**  
  基于 Docker (`node:slim`) 镜像运行，无需在 Runner 上安装任何额外依赖。

---

## 快速上手

在你的仓库中创建 `.github/workflows/image-compress.yml`：

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
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Compress Images
        id: compress
        uses: RainPPR/action-image-resize@main
        with:
          path: '.'   # 可选，指定处理的子目录，默认处理整个仓库
          # ignore: | # 可选，排除特定的文件或文件夹，支持通配符
          #   docs/favicon.png
          #   docs/xxx/**

      - name: Commit & Push
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: compress images and update markdown links"
```

> **可选**：若需要在 PR 中查看压缩报告，可在 `Commit & Push` 步骤之前添加：
>
> ```yaml
>       - name: Add PR Comment
>         if: github.event_name == 'pull_request'
>         uses: mshick/add-pr-comment@v2
>         with:
>           message: ${{ steps.compress.outputs.summary }}
> ```

---

## 输入与输出

### Inputs

| 参数 | 说明 | 是否必填 | 默认值 |
| :--- | :--- | :---: | :--- |
| `path` | 要处理的目录（相对于仓库根目录） | 否 | `.` |
| `ignore` | 要忽略的文件或文件夹（支持通配符），每行一个 | 否 | `''` |

### Outputs

| 参数 | 说明 |
| :--- | :--- |
| `summary` | Markdown 格式的压缩结果摘要 |

### Environment Variables

本 Action 运行后会向 `$GITHUB_ENV` 写入 `IMAGE_COMPRESSION_SUMMARY`，内容与 `summary` 输出完全相同，可在后续步骤中通过 `${{ env.IMAGE_COMPRESSION_SUMMARY }}` 引用。

---

## 工作原理

以下是 Action 的内部执行流程：

```
1. 扫描阶段
   ├─ glob 递归检索指定目录下的 *.{png,jpg,jpeg,webp,gif}
   └─ glob 递归检索指定目录下的 *.svg

2. 位图转码（Sharp）
   ├─ 读取元数据，若宽度 > 2560px 则 resize
   ├─ flatten（背景填白）→ 编码为 AVIF (quality=60, effort=7)
   ├─ 写入临时文件 *.avif.tmp
   ├─ 计算临时文件的 SHA-256，取后 7 位作为哈希标识
   ├─ 重命名为 <原始名>-<sha7>.avif
   └─ 删除原始文件，记录路径映射到 convertedMap

3. SVG 处理
   ├─ 按大小/内容分级判断（见"核心特性"表格）
   ├─ 需转换：临时文件 → 计算 SHA7 → 重命名 → 删除原 SVG → 记录映射
   └─ 保留 SVG：SVGO multipass 极限优化，原地覆写

4. Markdown 路径同步
   ├─ glob 检索所有 *.md 文件
   ├─ 正则匹配 ![](相对路径) 与 <img src="相对路径">
   ├─ 对命中 convertedMap 的路径，从 Map 中取获得新绝对路径，计算相对路径后替换
   └─ 内容有变动时写回文件

5. 统计与报告
   └─ 输出 Job Summary / GITHUB_OUTPUT / GITHUB_ENV
```

**关于命名哈希**：为防止 `image-1.png` 与 `image-1.svg` 等不同来源文件在同一目录下转换后产生 `image-1.avif` 命名冲突，每个 AVIF 输出文件名中均嵌入该文件内容的 SHA-256 后 7 位，从根本上消除冲突。

---

## 注意事项

- **操作不可逆**：本 Action 会直接删除原图，确保工作流中有 `git-auto-commit-action` 或等效的提交步骤，以便随时通过 `git revert` 恢复。
- **路径中不要包含空格**：图片路径中若含有空格字符，可能导致 Markdown 引用解析失败，建议在运行前检查并重命名。
- **SVG 数值精度**：SVGO 极限优化会将 SVG 中的浮点数精度降至 2 位小数，对常规屏幕显示无感，但不适合作为高精度矢量编辑的源文件存储。
- **重复运行**：已转换为 AVIF 的文件不在扫描范围内（glob 只匹配位图和 SVG），不会被二次处理；但保留为 SVG 的文件每次运行都会被 SVGO 再次处理，请注意控制触发频率。

---

## 贡献与反馈

本项目由 [RainPPR](https://github.com/RainPPR) 独立维护，定位为个人工具，精力有限。

- **欢迎**：Bug 报告、文档错误修正、现有逻辑的优化建议——请直接提 [Issue](https://github.com/RainPPR/action-image-resize/issues) 或 [Pull Request](https://github.com/RainPPR/action-image-resize/pulls)，我会认真查看。
- **暂不接受**：大规模功能增强请求（Feature Request）。由于项目的定位和维护精力，超出当前范围的功能性变更大概率不会被合并，提前说明以免浪费您的时间。

---

## 许可证

[MIT License](LICENSE) © [RainPPR](https://github.com/RainPPR)
