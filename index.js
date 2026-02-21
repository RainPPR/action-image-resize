const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { glob } = require('glob');
const sharp = require('sharp');
const { optimize } = require('svgo');

/**
 * 计算文件内容的 SHA-256，返回后7位十六进制字符串。
 */
async function getFileSha7(filePath) {
  const buf = await fs.readFile(filePath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  return hash.slice(-7);
}

/**
 * 根据原始文件路径和 sha7 构造带 sha7 后缀的 .avif 路径。
 * 例如：/foo/image-1.png + a3f8c2d -> /foo/image-1-a3f8c2d.avif
 */
function buildAvifPath(originalFile, sha7) {
  const ext = path.extname(originalFile);
  const base = originalFile.slice(0, originalFile.length - ext.length);
  return `${base}-${sha7}.avif`;
}

const logger = {
  _ts: () => {
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  },
  info: (msg) => console.log(`[${logger._ts()}] [INFO] ${msg}`),
  step: (msg) => console.log(`[${logger._ts()}] [STEP] ${msg}`),
  item: (msg) => console.log(`[${logger._ts()}] [ITEM] ${msg}`),
  done: (msg) => console.log(`[${logger._ts()}] [DONE] ${msg || 'Completed'}`),
  sub: (msg) => console.log(`[${logger._ts()}] [SUB]  ${msg}`),
  warn: (msg) => console.log(`[${logger._ts()}] [WARN] ${msg}`),
  error: (msg, err) => console.error(`[${logger._ts()}] [ERR]  ${msg}${err ? `: ${err.message}` : ''}`),
};

const formatSize = (bytes) => (bytes / 1024).toFixed(2) + ' KB';
const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

async function run() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const targetSubDir = process.env.INPUT_PATH || '.';
  const searchRoot = path.resolve(workspace, targetSubDir);

  const ignoreInput = process.env.INPUT_IGNORE || '';
  const customIgnores = ignoreInput
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  const ignoreList = ['node_modules/**', '.git/**', ...customIgnores];

  logger.info(`Workspace: ${workspace}`);
  logger.info(`Target path: ${searchRoot}`);
  if (customIgnores.length > 0) {
    logger.info(`Ignored patterns: ${customIgnores.join(', ')}`);
  }

  const stats = {
    processed: 0,
    originalSize: 0,
    newSize: 0,
    types: { bitmap: 0, svg: 0 }
  };

  const convertedMap = new Map(); // Absolute original path -> Absolute new path

  // 1. Process Bitmaps (PNG, JPG, JPEG, WEBP, GIF) -> AVIF
  const imageFiles = await glob('**/*.{png,jpg,jpeg,webp,gif}', {
    cwd: searchRoot,
    ignore: ignoreList,
    nodir: true,
    absolute: true
  });

  logger.step(`Processing ${imageFiles.length} bitmap images...`);

  for (const file of imageFiles) {
    const relativePath = path.relative(searchRoot, file);

    try {
      const originalStat = await fs.stat(file);
      stats.originalSize += originalStat.size;

      logger.item(`${relativePath} (${formatSize(originalStat.size)})`);
      const image = sharp(file);
      const metadata = await image.metadata();

      let pipeline = image;
      if (metadata.width > 2560) {
        logger.sub(`Resizing from ${metadata.width}px -> 2560px`);
        pipeline = pipeline.resize(2560);
      }

      // 先写入临时文件，计算 SHA 后重命名为最终带 sha7 的路径
      const tmpFile = file + '.avif.tmp';
      await pipeline
        .flatten({ background: '#FFFFFF' })
        .avif({ quality: 65, effort: 9 })
        .toFile(tmpFile);

      const sha7 = await getFileSha7(tmpFile);
      const newFile = buildAvifPath(file, sha7);
      await fs.rename(tmpFile, newFile);

      const newStat = await fs.stat(newFile);
      stats.newSize += newStat.size;
      stats.processed++;
      stats.types.bitmap++;

      await fs.unlink(file);
      convertedMap.set(file, newFile);
      logger.done(`AVIF: ${formatSize(newStat.size)} [sha:${sha7}]`);
    } catch (err) {
      logger.error(`Error processing ${relativePath}`, err);
    }
  }

  // 2. Process SVGs -> SVGO or AVIF
  const svgFiles = await glob('**/*.svg', {
    cwd: searchRoot,
    ignore: ignoreList,
    nodir: true,
    absolute: true
  });

  logger.step(`Processing ${svgFiles.length} SVG files...`);

  for (const file of svgFiles) {
    const relativePath = path.relative(searchRoot, file);
    try {
      const originalStat = await fs.stat(file);
      const originalSize = originalStat.size;
      stats.originalSize += originalSize;

      logger.item(`${relativePath} (${formatSize(originalSize)})`);

      let shouldConvertToAvif = false;
      let forceAvif = false;
      let avifCreated = false;

      if (originalSize >= 100 * 1024) {
        forceAvif = true;
        shouldConvertToAvif = true;
        logger.sub(`Size >= 100KB, forcing AVIF.`);
      } else if (originalSize >= 40 * 1024) {
        const content = await fs.readFile(file, 'utf8');
        const hasInlineAssets = /data:image\/|@font-face|<font/i.test(content);
        if (hasInlineAssets) {
          forceAvif = true;
          shouldConvertToAvif = true;
          logger.sub(`Contains inline assets, forcing AVIF.`);
        }
      }

      // 使用临时文件路径，后续计算 sha7 后重命名
      const tmpFile = file + '.avif.tmp';
      let finalAvifFile = null; // 最终带 sha7 的 avif 路径，稍后确定

      if (!forceAvif && originalSize >= 10 * 1024) {
        logger.sub(`Attempting trial SVG->AVIF conversion...`);
        const image = sharp(file);
        const metadata = await image.metadata();
        let targetWidth = (metadata.width || 1000) * 2;
        if (targetWidth > 1080) targetWidth = 1080;

        await image
          .resize({ width: Math.round(targetWidth) })
          .avif({ quality: 60, effort: 9 })
          .toFile(tmpFile);

        const avifStat = await fs.stat(tmpFile);
        const avifSize = avifStat.size;
        let ratioMet = false;

        if (originalSize >= 40 * 1024) {
          if (avifSize < originalSize * 0.5) ratioMet = true;
        } else {
          if (avifSize < originalSize * 0.2) ratioMet = true;
        }

        if (ratioMet) {
          shouldConvertToAvif = true;
          avifCreated = true;
          logger.sub(`Ratio met (${(avifSize / originalSize).toFixed(2)}x), keeping AVIF.`);
        } else {
          await fs.unlink(tmpFile);
          logger.sub(`Ratio not met (${(avifSize / originalSize).toFixed(2)}x), fallback to SVGO.`);
        }
      }

      if (shouldConvertToAvif) {
        if (!avifCreated) {
          const image = sharp(file);
          const metadata = await image.metadata();
          let targetWidth = (metadata.width || 1000) * 2;
          if (targetWidth > 1080) targetWidth = 1080;

          await image
            .resize({ width: Math.round(targetWidth) })
            .avif({ quality: 60, effort: 7 })
            .toFile(tmpFile);
        }

        // 计算 sha7 并重命名为最终文件
        const sha7 = await getFileSha7(tmpFile);
        finalAvifFile = buildAvifPath(file, sha7);
        await fs.rename(tmpFile, finalAvifFile);

        const newStat = await fs.stat(finalAvifFile);
        stats.newSize += newStat.size;
        stats.processed++;
        stats.types.bitmap++;

        await fs.unlink(file);
        convertedMap.set(file, finalAvifFile);
        logger.done(`AVIF: ${formatSize(newStat.size)} [sha:${sha7}]`);
      } else {
        const svgData = await fs.readFile(file, 'utf8');

        const result = optimize(svgData, {
          path: file,
          multipass: true,                    // 多轮优化，收益大且安全
          plugins: [
            {
              name: "preset-default",
              params: {
                overrides: {
                  // === 必须关闭的危险插件（导致渲染错误的元凶，已逐个确认）===
                  removeUselessStrokeAndFill: false,   // 表格细线/网格消失最常见原因
                  removeHiddenElems: false,            // 误删 opacity/visibility 元素 → 空白
                  removeOffCanvasPaths: false,         // 边缘线被裁剪
                  mergePaths: false,                   // 合并后抗锯齿/接头改变 → 线条变细
                  convertShapeToPath: false,           // 保留 <rect>/<line> 原生渲染更准

                  // === 数值精度（关键修复：原来 floatPrecision:2 太激进）===
                  cleanupNumericValues: {
                    floatPrecision: 4,                 // 安全且足够小
                    leadingZero: false,
                    defaultPx: true,
                    convertToPx: true
                  },

                  convertPathData: {
                    floatPrecision: 4,
                    transformPrecision: 6,
                    applyTransforms: false,            // 不烘焙 transform（防描边偏移）
                    applyTransformsStroked: false,
                    removeUseless: false,              // 防止误删路径段
                    collapseRepeated: true,
                    lineShorthands: true
                  },

                  convertTransform: {
                    floatPrecision: 4,
                    transformPrecision: 6,
                    degPrecision: 3
                  },

                  // ID 处理（配合 prefixIds 更稳）
                  cleanupIds: {
                    minify: true                       // 可压缩，prefix 会保证唯一
                  },

                  // convertColors（保留你原来的设置）
                  convertColors: {
                    currentColor: false,
                    names2hex: true,
                    rgb2hex: true,
                    convertCase: "lower",
                    shorthex: true,
                    shortname: true
                  }
                }
              }
            },

            // === 额外安全、高收益插件（不在 preset-default 或需自定义）===
            {
              name: "cleanupListOfValues",
              params: {
                floatPrecision: 4,
                leadingZero: false,
                defaultPx: true,
                convertToPx: true
              }
            },

            "convertOneStopGradients",           // 单色渐变转纯色，安全
            "convertStyleToAttrs",               // 你原来的，保留（样式转属性）

            // === 防多 SVG 内联 ID 冲突（最重要新增之一）===
            {
              name: "prefixIds",
              params: {
                prefix: () => `svg_${(file || Date.now().toString()).replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 12)}`,
                delim: "__",
                prefixIds: true,
                prefixClassNames: false            // class 不加前缀（通常不需要）
              }
            },

            // === 实用 Web 增强 ===
            "removeDimensions",                  // 移除固定 width/height → 响应式（强烈推荐）
            "sortAttrs",                         // 属性排序，提升 gzip/brotli 压缩率
            "sortDefsChildren"                   // <defs> 内排序，同样提升压缩
          ]
        });

        if (result.data) {
          await fs.writeFile(file, result.data);
          const newStat = await fs.stat(file);
          stats.newSize += newStat.size;
          stats.processed++;
          stats.types.svg++;
          logger.done(`SVGO: ${formatSize(newStat.size)}`);
        }
      }
    } catch (err) {
      logger.error(`Error processing SVG ${relativePath}`, err);
    }
  }

  // 3. Update Markdown files
  const mdFiles = await glob('**/*.md', {
    cwd: searchRoot,
    ignore: ignoreList,
    nodir: true,
    absolute: true
  });

  logger.step(`Checking ${mdFiles.length} Markdown files for link updates...`);

  const markdownImgRegex = /(!\[.*?\]\((?!https?:\/\/)(.*?\.(?:png|jpg|jpeg|webp|gif|svg))\))|(<img\b[^>]*?\bsrc=["'](?!https?:\/\/)(.*?\.(?:png|jpg|jpeg|webp|gif|svg))["'][^>]*?>)/gi;

  for (const mdFile of mdFiles) {
    const relativeMdPath = path.relative(searchRoot, mdFile);
    try {
      const content = await fs.readFile(mdFile, 'utf8');
      const mdDir = path.dirname(mdFile);

      const updatedContent = content.replace(markdownImgRegex, (match, mdFull, mdPath, htmlFull, htmlPath) => {
        const rawPath = mdPath || htmlPath;
        if (!rawPath) return match;

        const fullOriginalPath = path.resolve(mdDir, rawPath);

        if (convertedMap.has(fullOriginalPath)) {
          // 从 convertedMap 取得实际的新文件绝对路径（已含 sha7），计算相对路径替换
          const newAbsPath = convertedMap.get(fullOriginalPath);
          const newPath = path.relative(mdDir, newAbsPath).replace(/\\/g, '/');
          return (mdPath ? mdFull : htmlFull).replace(rawPath, newPath);
        }

        return match;
      });

      if (content !== updatedContent) {
        logger.item(`Updating links in ${relativeMdPath}`);
        await fs.writeFile(mdFile, updatedContent, 'utf8');
        logger.done();
      }
    } catch (err) {
      logger.error(`Error updating links in ${relativeMdPath}`, err);
    }
  }

  // 4. Summarize and Output
  const savedSize = stats.originalSize - stats.newSize;
  const savedPercent = stats.originalSize > 0 ? ((savedSize / stats.originalSize) * 100).toFixed(2) : 0;

  const summaryMarkdown = `### Image Compression Summary

- **Total Processed:** ${stats.processed} files

  - Bitmaps (to AVIF): ${stats.types.bitmap}

  - SVGs (SVGO Optimized): ${stats.types.svg}

- **Storage Saved:** ${formatMB(savedSize)} (${savedPercent}%)

- **Original Total Size:** ${formatMB(stats.originalSize)}

- **New Total Size:** ${formatMB(stats.newSize)}
`;

  console.log('\n' + summaryMarkdown);

  // Set Output and Env for GitHub Actions
  const delimiter = `EOF_${Math.random().toString(36).substring(7)}`;

  if (process.env.GITHUB_OUTPUT) {
    const outputContent = `summary<<${delimiter}\n${summaryMarkdown}\n${delimiter}\n`;
    fsSync.appendFileSync(process.env.GITHUB_OUTPUT, outputContent);
  }

  if (process.env.GITHUB_ENV) {
    const envContent = `IMAGE_COMPRESSION_SUMMARY<<${delimiter}\n${summaryMarkdown}\n${delimiter}\n`;
    fsSync.appendFileSync(process.env.GITHUB_ENV, envContent);
  }

  logger.step('All tasks completed successfully!');
}

run().catch(err => {
  console.error('\n[FATAL] Critical Error:', err);
  process.exit(1);
});
