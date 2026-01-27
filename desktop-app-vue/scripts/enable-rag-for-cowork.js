#!/usr/bin/env node
/**
 * Enable RAG for Cowork Script
 *
 * This script modifies the RAG configuration to enable RAG in memory mode
 * for Cowork integration testing.
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Enabling RAG for Cowork Integration\n');

const ragManagerPath = path.join(__dirname, '../src/main/rag/rag-manager.js');

// Read the file
let content = fs.readFileSync(ragManagerPath, 'utf-8');

// Backup original file
const backupPath = ragManagerPath + '.backup';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, content, 'utf-8');
  console.log('✅ Backup created:', backupPath);
}

// Check current status
const currentlyEnabled = content.includes('enableRAG: true');

if (currentlyEnabled) {
  console.log('ℹ️  RAG is already enabled');
  console.log('\nCurrent configuration:');
  console.log('  - enableRAG: true ✅');
  console.log('  - useChromaDB: false (in-memory mode)');
  console.log('  - Ready for Cowork integration\n');
  process.exit(0);
}

// Enable RAG
content = content.replace(
  /enableRAG: false,(\s+\/\/ 是否启用RAG)/,
  'enableRAG: true,$1'
);

// Write back
fs.writeFileSync(ragManagerPath, content, 'utf-8');

console.log('✅ RAG enabled in rag-manager.js');
console.log('\nConfiguration updated:');
console.log('  - enableRAG: false → true ✅');
console.log('  - useChromaDB: false (in-memory mode)');
console.log('  - topK: 10');
console.log('  - similarityThreshold: 0.6');
console.log('  - enableReranking: true');
console.log('  - enableHybridSearch: true');

console.log('\n📋 Next Steps:');
console.log('  1. Restart desktop app: npm run dev');
console.log('  2. RAG will initialize automatically');
console.log('  3. Cowork agents can query knowledge base');
console.log('  4. Test with: node scripts/test-rag-cowork-integration.js\n');

console.log('💡 To restore original configuration:');
console.log(`  cp "${backupPath}" "${ragManagerPath}"\n`);
