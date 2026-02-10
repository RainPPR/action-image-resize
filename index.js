const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { glob } = require('glob');
const sharp = require('sharp');
const { optimize } = require('svgo');

const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  step: (msg) => console.log(`\n🚀 ${msg}`),
  item: (msg) => console.log(`  - ${msg}`),
  sub: (msg) => console.log(`    └─ ${msg}`),
  success: (msg) => console.log(`  ✅ ${msg}`),
  warn: (msg) => console.log(`  ⚠️  ${msg}`),
  error: (msg, err) => console.error(`  ❌ ${msg}${err ? `: ${err.message}` : ''}`),
};

const formatSize = (bytes) => (bytes / 1024).toFixed(2) + ' KB';
const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

async function run() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const targetSubDir = process.env.INPUT_PATH || '.';
  const searchRoot = path.resolve(workspace, targetSubDir);

  logger.info(`Workspace: ${workspace}`);
  logger.info(`Target path: ${searchRoot}`);

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
    ignore: ['node_modules/**', '.git/**'],
    nodir: true,
    absolute: true
  });

  logger.step(`Processing ${imageFiles.length} bitmap images...`);

  for (const file of imageFiles) {
    const relativePath = path.relative(searchRoot, file);
    const ext = path.extname(file).toLowerCase();
    const newFile = file.replace(new RegExp(`${ext}$`, 'i'), '.avif');

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

      await pipeline
        .avif({ quality: 65, effort: 7 })
        .toFile(newFile);

      const newStat = await fs.stat(newFile);
      stats.newSize += newStat.size;
      stats.processed++;
      stats.types.bitmap++;

      await fs.unlink(file);
      convertedMap.set(file, newFile);
      logger.success(`Converted to AVIF (${formatSize(newStat.size)})`);
    } catch (err) {
      logger.error(`Error processing ${relativePath}`, err);
    }
  }

  // 2. Process SVGs -> SVGO or AVIF
  const svgFiles = await glob('**/*.svg', {
    cwd: searchRoot,
    ignore: ['node_modules/**', '.git/**'],
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

      const newFile = file.replace(/\.svg$/i, '.avif');

      if (!forceAvif && originalSize >= 10 * 1024) {
        logger.sub(`Attempting trial SVG->AVIF conversion...`);
        const image = sharp(file);
        const metadata = await image.metadata();
        let targetWidth = (metadata.width || 1000) * 2;
        if (targetWidth > 1080) targetWidth = 1080;

        await image
          .resize({ width: Math.round(targetWidth) })
          .avif({ quality: 65, effort: 7 })
          .toFile(newFile);

        const avifStat = await fs.stat(newFile);
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
          await fs.unlink(newFile);
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
            .avif({ quality: 65, effort: 7 })
            .toFile(newFile);
        }

        const newStat = await fs.stat(newFile);
        stats.newSize += newStat.size;
        stats.processed++;
        stats.types.bitmap++;

        await fs.unlink(file);
        convertedMap.set(file, newFile);
        logger.success(`Converted to AVIF (${formatSize(newStat.size)})`);
      } else {
        const svgData = await fs.readFile(file, 'utf8');
        const result = optimize(svgData, {
          path: file,
          multipass: true,
          plugins: [
            "cleanupAttrs", "cleanupIds",
            { name: "cleanupNumericValues", params: { floatPrecision: 2, leadingZero: false, defaultPx: true, convertToPx: true } },
            { name: "cleanupListOfValues", params: { floatPrecision: 2, leadingZero: false, defaultPx: true, convertToPx: true } },
            "collapseGroups",
            { name: "convertColors", params: { currentColor: false, names2hex: true, rgb2hex: true, convertCase: "lower", shorthex: true, shortname: true } },
            "convertEllipseToCircle", "convertOneStopGradients", "convertPathData", "convertShapeToPath", "convertStyleToAttrs",
            "convertTransform", "mergePaths", "mergeStyles", "minifyStyles", "removeComments", "removeDeprecatedAttrs",
            "removeDesc", "removeDoctype", "removeEditorsNSData", "removeEmptyAttrs", "removeEmptyContainers", "removeEmptyText",
            "removeHiddenElems", "removeMetadata", "removeOffCanvasPaths", "removeTitle", "removeUnknownsAndDefaults",
            "removeUnusedNS", "removeUselessDefs", "removeUselessStrokeAndFill", "removeXlink", "reusePaths"
          ]
        });

        if (result.data) {
          await fs.writeFile(file, result.data);
          const newStat = await fs.stat(file);
          stats.newSize += newStat.size;
          stats.processed++;
          stats.types.svg++;
          logger.success(`Optimized with SVGO (${formatSize(newStat.size)})`);
        }
      }
    } catch (err) {
      logger.error(`Error processing SVG ${relativePath}`, err);
    }
  }

  // 3. Update Markdown files
  const mdFiles = await glob('**/*.md', {
    cwd: searchRoot,
    ignore: ['node_modules/**', '.git/**'],
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
          const newPath = rawPath.replace(/\.(png|jpg|jpeg|webp|gif|svg)$/i, '.avif');
          return (mdPath ? mdFull : htmlFull).replace(rawPath, newPath);
        }

        return match;
      });

      if (content !== updatedContent) {
        await fs.writeFile(mdFile, updatedContent, 'utf8');
        logger.success(`Updated links in ${relativeMdPath}`);
      }
    } catch (err) {
      logger.error(`Error updating links in ${relativeMdPath}`, err);
    }
  }

  // 4. Summarize and Output
  const savedSize = stats.originalSize - stats.newSize;
  const savedPercent = stats.originalSize > 0 ? ((savedSize / stats.originalSize) * 100).toFixed(2) : 0;

  const summaryText = `### 🚀 Image Compression Summary

- **Total Processed:** ${stats.processed} files

  - 🖼️ Bitmaps (to AVIF): ${stats.types.bitmap}

  - ⚡ SVGs (SVGO Optimized): ${stats.types.svg}

- **Storage Saved:** ${formatMB(savedSize)} (${savedPercent}%)

- **Original Total Size:** ${formatMB(stats.originalSize)}

- **New Total Size:** ${formatMB(stats.newSize)}
`;

  console.log('\n' + summaryText);

  // Set Output and Env for GitHub Actions
  const delimiter = `EOF_${Math.random().toString(36).substring(7)}`;

  if (process.env.GITHUB_OUTPUT) {
    const outputContent = `summary<<${delimiter}\n${summaryText}\n${delimiter}\n`;
    fsSync.appendFileSync(process.env.GITHUB_OUTPUT, outputContent);
  }

  if (process.env.GITHUB_ENV) {
    const envContent = `IMAGE_COMPRESSION_SUMMARY<<${delimiter}\n${summaryText}\n${delimiter}\n`;
    fsSync.appendFileSync(process.env.GITHUB_ENV, envContent);
  }

  logger.step('All tasks completed successfully! 🎉');
}

run().catch(err => {
  console.error('\n❌ Critical Error:', err);
  process.exit(1);
});
