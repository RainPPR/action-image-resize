const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');
const sharp = require('sharp');

async function process() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const targetSubDir = process.env.INPUT_PATH || '.';
  const searchRoot = path.resolve(workspace, targetSubDir);

  console.log(`Starting image compression in: ${searchRoot}`);

  // 1. Find all bitmap images
  const imageFiles = await glob('**/*.{png,jpg,jpeg,webp}', {
    cwd: searchRoot,
    ignore: ['node_modules/**', '.git/**'],
    nodir: true,
    absolute: true
  });

  console.log(`Found ${imageFiles.length} images to process.`);

  const processedImages = new Map(); // Old path -> New path (for logging/debugging)

  for (const file of imageFiles) {
    const ext = path.extname(file).toLowerCase();
    const newFile = file.replace(new RegExp(`\\${ext}$`, 'i'), '.avif');

    try {
      console.log(`Processing: ${file}`);
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

      // Remove original file
      await fs.unlink(file);
      processedImages.set(file, newFile);
      console.log(`  Converted to AVIF: ${newFile}`);
    } catch (err) {
      console.error(`  Error processing ${file}: ${err.message}`);
    }
  }

  // 2. Update Markdown files
  const mdFiles = await glob('**/*.md', {
    cwd: searchRoot,
    ignore: ['node_modules/**', '.git/**'],
    nodir: true,
    absolute: true
  });

  console.log(`Updating links in ${mdFiles.length} Markdown files.`);

  // Regex to match image extensions in Markdown (including inside HTML src attributes)
  // Matches: .png, .jpg, .jpeg, .webp (case insensitive)
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

  console.log('Finished processing all files.');
}

process().catch(err => {
  console.error('Critical Error:', err);
  process.exit(1);
});
