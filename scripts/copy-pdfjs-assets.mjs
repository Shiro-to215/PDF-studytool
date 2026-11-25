import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pdfjsDir = path.join(rootDir, 'node_modules', 'pdfjs-dist');
const publicPdfjsDir = path.join(rootDir, 'public', 'pdfjs');

if (!fs.existsSync(pdfjsDir)) {
  console.error('[copy-pdfjs-assets] Error: node_modules/pdfjs-dist not found.');
  process.exit(1);
}

function copyDirFlatOrRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirFlatOrRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

for (const folder of ['cmaps', 'standard_fonts']) {
  const src = path.join(pdfjsDir, folder);
  const dest = path.join(publicPdfjsDir, folder);
  if (!fs.existsSync(src)) {
    console.error(`[copy-pdfjs-assets] Error: ${src} not found.`);
    process.exit(1);
  }
  copyDirFlatOrRecursive(src, dest);
}
