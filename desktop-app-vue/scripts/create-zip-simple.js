const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const outputDir = path.join(__dirname, '..', 'out');
const sourceDir = path.join(outputDir, 'ChainlessChain-win32-x64');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const outputFile = path.join(outputDir, `ChainlessChain-Windows-x64-v0.16.0-${timestamp}.zip`);

console.log('Creating ZIP package with adm-zip...');
console.log('Source:', sourceDir);
console.log('Output:', outputFile);

try {
  const zip = new AdmZip();

  // Add directory with base folder name
  console.log('Adding files...');
  zip.addLocalFolder(sourceDir, 'ChainlessChain-win32-x64');

  console.log('Writing ZIP file...');
  zip.writeZip(outputFile);

  const stats = fs.statSync(outputFile);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log(`\n✓ ZIP package created successfully!`);
  console.log(`  File: ${path.basename(outputFile)}`);
  console.log(`  Size: ${sizeMB} MB`);
  console.log(`  Location: ${outputFile}`);
} catch (error) {
  console.error('Error creating ZIP:', error);
  process.exit(1);
}
