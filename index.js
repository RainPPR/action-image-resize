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

  // 1. Process Bitmaps (PNG, JPG, JPEG, WEBP) -> AVIF
  const imageFiles = await glob('**/*.{png,jpg,jpeg,webp}', {
    cwd: searchRoot,
    ignore: ['node_modules/**', '.git/**'],
    nodir: true,
    absolute: true
  });

  console.log(`Found ${imageFiles.length} bitmap images to process.`);

  for (const file of imageFiles) {
    const ext = path.extname(file).toLowerCase();
    const newFile = file.replace(new RegExp(`\\${ext}$`, 'i'), '.avif');

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
        .avif({ quality: 60 })
        .toFile(newFile);

      const newStat = await fs.stat(newFile);
      stats.newSize += newStat.size;
      stats.processed++;
      stats.types.bitmap++;

      await fs.unlink(file);
      console.log(`  Converted to AVIF: ${newFile} (${(newStat.size / 1024).toFixed(2)} KB)`);
    } catch (err) {
      console.error(`  Error processing bitmap ${file}: ${err.message}`);
    }
  }

  // 2. Process SVGs -> SVGO
  const svgFiles = await glob('**/*.svg', {
    cwd: searchRoot,
    ignore: ['node_modules/**', '.git/**'],
    nodir: true,
    absolute: true
  });

  console.log(`Found ${svgFiles.length} SVG files to process.`);

  for (const file of svgFiles) {
    try {
      const svgData = await fs.readFile(file, 'utf8');
      const originalStat = await fs.stat(file);
      stats.originalSize += originalStat.size;

      console.log(`Processing SVG: ${file}`);
      const result = optimize(svgData, {
        path: file,
        multipass: true,
        js2svg: {
          indent: '',
          pretty: false
        },
        plugins: [
          {
            name: 'preset-default',
            params: {
              overrides: {
                cleanupNumericValues: { floatPrecision: 1, leadingZero: false },
                convertPathData: { floatPrecision: 1, applyTransforms: true }
              },
              removeViewBox: false,
              removeMetadata: true,
              removeTitle: true,
              removeDesc: true,
              removeUselessDefs: true,
              removeComments: true,
            },
          },
          'mergePaths',
          'removeXMLNS',
          'cleanupIds',
          'removeEmptyAttrs',
          'removeDimensions',
          'sortAttrs',
          'removeScriptElement',
          'removeStyleElement',
          'removeOffCanvasPaths'
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

  console.log(`Updating links in ${mdFiles.length} Markdown files.`);
  const imageExtRegex = /\.(png|jpg|jpeg|webp)(?=[)\s"']|$)/gi;

  for (const mdFile of mdFiles) {
    try {
      const content = await fs.readFile(mdFile, 'utf8');
      const updatedContent = content.replace(imageExtRegex, '.avif');

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
  - ⚡ SVGs (Optimized): ${stats.types.svg}
- **Storage Saved:** ${(savedSize / 1024 / 1024).toFixed(2)} MB (${savedPercent}%)
- **Original Total Size:** ${(stats.originalSize / 1024 / 1024).toFixed(2)} MB
- **New Total Size:** ${(stats.newSize / 1024 / 1024).toFixed(2)} MB`;

  console.log(summaryText);

  // Set Output and Env for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    // Append to GITHUB_OUTPUT using multiline support if needed, but summary is short enough
    fsSync.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${summaryText.replace(/\n/g, '%0A')}\n`);
  }
  
  if (process.env.GITHUB_ENV) {
    // For environment variable, we might want a slightly different format or multiline
    // We use the multiline syntax for GITHUB_ENV
    const envContent = `IMAGE_COMPRESSION_SUMMARY<<EOF\n${summaryText}\nEOF\n`;
    fsSync.appendFileSync(process.env.GITHUB_ENV, envContent);
  }

  console.log('Finished processing all files.');
}

run().catch(err => {
  console.error('Critical Error:', err);
  process.exit(1);
});
