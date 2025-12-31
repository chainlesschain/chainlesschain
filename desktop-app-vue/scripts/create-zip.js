const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '..', 'out');
const sourceDir = path.join(outputDir, 'ChainlessChain-win32-x64');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const outputFile = path.join(outputDir, `ChainlessChain-Windows-x64-v0.16.0-${timestamp}.zip`);

console.log('Creating ZIP package...');
console.log('Source:', sourceDir);
console.log('Output:', outputFile);

const output = fs.createWriteStream(outputFile);
const archive = archiver('zip', {
  zlib: { level: 9 }
});

output.on('close', () => {
  const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`\n✓ ZIP package created successfully!`);
  console.log(`  File: ${path.basename(outputFile)}`);
  console.log(`  Size: ${sizeMB} MB`);
  console.log(`  Location: ${outputFile}`);
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(sourceDir, 'ChainlessChain-win32-x64');
archive.finalize();
