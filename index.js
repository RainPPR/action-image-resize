const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { glob } = require('glob');
const sharp = require('sharp');
const { optimize } = require('svgo');

async function run() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const targetSubDir = process.env.INPUT_PATH || '.';
  const searchRoot = path.resolve(workspace, targetSubDir);

  console.log(`Starting image compression in: ${searchRoot}`);

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

  console.log(`Found ${imageFiles.length} bitmap images to process.`);

  for (const file of imageFiles) {
    const ext = path.extname(file).toLowerCase();
    const newFile = file.replace(new RegExp(`${ext}$`, 'i'), '.avif');

    try {
      const originalStat = await fs.stat(file);
      stats.originalSize += originalStat.size;

      console.log(`Processing bitmap: ${file}`);
      const image = sharp(file);
      const metadata = await image.metadata();

      let pipeline = image;
      if (metadata.width > 2560) {
        console.log(`  Resizing from ${metadata.width}px to 2560px`);
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
      console.log(`  Converted to AVIF: ${newFile} (${(newStat.size / 1024).toFixed(2)} KB)`);
    } catch (err) {
      console.error(`  Error processing bitmap ${file}: ${err.message}`);
    }
  }

  // 2. Process SVGs -> SVGO or AVIF
  const svgFiles = await glob('**/*.svg', {
    cwd: searchRoot,
    ignore: ['node_modules/**', '.git/**'],
    nodir: true,
    absolute: true
  });

  console.log(`Found ${svgFiles.length} SVG files to process.`);

  for (const file of svgFiles) {
    try {
      const originalStat = await fs.stat(file);
      stats.originalSize += originalStat.size;

      const originalSize = originalStat.size;
      let shouldConvertToAvif = false;
      let forceAvif = false;
      let avifCreated = false;

      // Rule 1: Always convert if >= 100KB
      if (originalSize >= 100 * 1024) {
        forceAvif = true;
        shouldConvertToAvif = true;
      }
      // Rule 2: Convert if >= 40KB and contains inline bitmaps/fonts
      else if (originalSize >= 40 * 1024) {
        const content = await fs.readFile(file, 'utf8');
        const hasInlineAssets = /data:image\/|@font-face|<font/i.test(content);
        if (hasInlineAssets) {
          forceAvif = true;
          shouldConvertToAvif = true;
        }
      }

      const newFile = file.replace(/\.svg$/i, '.avif');

      // Rule 3: Dynamic conversion for others >= 10KB
      if (!forceAvif && originalSize >= 10 * 1024) {
        console.log(`  Attempting trial SVG->AVIF conversion for ratio check: ${file}`);
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
          console.log(`  Ratio met (${(avifSize / originalSize).toFixed(2)}x), keeping AVIF.`);
        } else {
          await fs.unlink(newFile);
          console.log(`  Ratio NOT met (${(avifSize / originalSize).toFixed(2)}x), discarding AVIF.`);
        }
      }

      if (shouldConvertToAvif) {
        if (!avifCreated) {
          // Rule 1 or 2: Perform conversion now
          console.log(`  Converting SVG to AVIF: ${file} (${(originalSize / 1024).toFixed(2)} KB)`);
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
        stats.types.bitmap++; // Converted SVGs are tracked as bitmap/avif

        await fs.unlink(file);
        convertedMap.set(file, newFile);
        console.log(`  Final AVIF: ${newFile} (${(newStat.size / 1024).toFixed(2)} KB)`);
      } else {
        // Optimize small or non-conforming SVG with SVGO
        console.log(`  Optimizing SVG with SVGO: ${file}`);
        const svgData = await fs.readFile(file, 'utf8');
        const result = optimize(svgData, {
          path: file,
          multipass: true,
          plugins: [
            "cleanupAttrs",
            "cleanupIds",
            {
              name: "cleanupNumericValues",
              params: {
                floatPrecision: 2,
                leadingZero: false,
                defaultPx: true,
                convertToPx: true
              }
            },
            {
              name: "cleanupListOfValues",
              params: {
                floatPrecision: 2,
                leadingZero: false,
                defaultPx: true,
                convertToPx: true
              }
            },
            "collapseGroups",
            {
              name: "convertColors",
              params: {
                currentColor: false,
                names2hex: true,
                rgb2hex: true,
                convertCase: "lower",
                shorthex: true,
                shortname: true
              }
            },
            "convertEllipseToCircle",
            "convertOneStopGradients",
            "convertPathData",
            "convertShapeToPath",
            "convertStyleToAttrs",
            "convertTransform",
            "mergePaths",
            "mergeStyles",
            "minifyStyles",
            "removeComments",
            "removeDeprecatedAttrs",
            "removeDesc",
            "removeDoctype",
            "removeEditorsNSData",
            "removeEmptyAttrs",
            "removeEmptyContainers",
            "removeEmptyText",
            "removeHiddenElems",
            "removeMetadata",
            "removeOffCanvasPaths",
            "removeTitle",
            "removeUnknownsAndDefaults",
            "removeUnusedNS",
            "removeUselessDefs",
            "removeUselessStrokeAndFill",
            "removeXlink",
            "reusePaths"
          ]
        });

        if (result.data) {
          await fs.writeFile(file, result.data);
          const newStat = await fs.stat(file);
          stats.newSize += newStat.size;
          stats.processed++;
          stats.types.svg++;
          console.log(`  Optimized SVG: ${file} (${(newStat.size / 1024).toFixed(2)} KB)`);
        }
      }
    } catch (err) {
      console.error(`  Error processing SVG ${file}: ${err.message}`);
    }
  }

  // 3. Update Markdown files
  const mdFiles = await glob('**/*.md', {
    cwd: searchRoot,
    ignore: ['node_modules/**', '.git/**'],
    nodir: true,
    absolute: true
  });

  console.log(`Checking link updates in ${mdFiles.length} Markdown files.`);

  // Regex to match local image paths in ![]() or <img src="">
  const markdownImgRegex = /(!\[.*?\]\((?!https?:\/\/)(.*?\.(?:png|jpg|jpeg|webp|gif|svg))\))|(<img\b[^>]*?\bsrc=["'](?!https?:\/\/)(.*?\.(?:png|jpg|jpeg|webp|gif|svg))["'][^>]*?>)/gi;

  for (const mdFile of mdFiles) {
    try {
      const content = await fs.readFile(mdFile, 'utf8');
      const mdDir = path.dirname(mdFile);

      const updatedContent = content.replace(markdownImgRegex, (match, mdFull, mdPath, htmlFull, htmlPath) => {
        const rawPath = mdPath || htmlPath;
        if (!rawPath) return match;

        // Resolve path to absolute to check if it was converted
        const fullOriginalPath = path.resolve(mdDir, rawPath);

        if (convertedMap.has(fullOriginalPath)) {
          const newPath = rawPath.replace(/\.(png|jpg|jpeg|webp|gif|svg)$/i, '.avif');
          return (mdPath ? mdFull : htmlFull).replace(rawPath, newPath);
        }

        return match;
      });

      if (content !== updatedContent) {
        await fs.writeFile(mdFile, updatedContent, 'utf8');
        console.log(`Updated link in: ${mdFile}`);
      }
    } catch (err) {
      console.error(`Error processing markdown ${mdFile}: ${err.message}`);
    }
  }

  // 4. Summarize and Output
  const savedSize = stats.originalSize - stats.newSize;
  const savedPercent = stats.originalSize > 0 ? ((savedSize / stats.originalSize) * 100).toFixed(2) : 0;

  const summaryText = `### 🚀 Image Compression Summary

- **Total Processed:** ${stats.processed} files

  - 🖼️ Bitmaps (to AVIF): ${stats.types.bitmap}

  - ⚡ SVGs (SVGO Optimized): ${stats.types.svg}

- **Storage Saved:** ${(savedSize / 1024 / 1024).toFixed(2)} MB (${savedPercent}%)

- **Original Total Size:** ${(stats.originalSize / 1024 / 1024).toFixed(2)} MB

- **New Total Size:** ${(stats.newSize / 1024 / 1024).toFixed(2)} MB
`;

  console.log(summaryText);

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

  console.log('Finished processing all files.');
}

run().catch(err => {
  console.error('Critical Error:', err);
  process.exit(1);
});
