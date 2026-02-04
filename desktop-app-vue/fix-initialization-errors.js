#!/usr/bin/env node

/**
 * Quick Fix Script for Initialization Errors
 * Automatically fixes common initialization issues
 */

const fs = require('fs');
const path = require('path');

const _fixes = [];
let errorsFixed = 0;
let errorsFound = 0;

console.log('='.repeat(60));
console.log('ChainlessChain Desktop App - Initialization Error Fixer');
console.log('='.repeat(60));
console.log('');

// Fix 1: Replace a-statistic-group with div
function fixAutomationRules() {
  const filePath = path.join(__dirname, 'src/renderer/components/projects/AutomationRules.vue');

  try {
    if (!fs.existsSync(filePath)) {
      console.log('⚠️  AutomationRules.vue not found, skipping...');
      return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;

    // Replace a-statistic-group with div
    content = content.replace(/<a-statistic-group>/g, '<div class="statistic-group">');
    content = content.replace(/<\/a-statistic-group>/g, '</div>');

    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('✓ Fixed: Replaced <a-statistic-group> with <div> in AutomationRules.vue');
      errorsFixed++;
    } else {
      console.log('✓ No issues found in AutomationRules.vue');
    }
  } catch (error) {
    console.error('✗ Failed to fix AutomationRules.vue:', error.message);
    errorsFound++;
  }
}

// Fix 2: Add debug logging to main index.js
function addDebugLogging() {
  const filePath = path.join(__dirname, 'src/main/index.js');

  try {
    if (!fs.existsSync(filePath)) {
      console.log('⚠️  src/main/index.js not found, skipping...');
      return;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // Check if debug logging already exists
    if (content.includes('Initialized modules:')) {
      console.log('✓ Debug logging already exists in index.js');
      return;
    }

    // Find the line after "Bootstrap 初始化完成"
    const searchString = 'logger.info("[Main] Bootstrap 初始化完成");';
    if (content.includes(searchString)) {
      const debugCode = `
    logger.info("[Main] Initialized modules:", Object.keys(instances));
    logger.info("[Main] templateManager status:", {
      exists: !!this.templateManager,
      type: typeof this.templateManager,
      isFunction: typeof this.templateManager?.getAllTemplates === 'function'
    });`;

      content = content.replace(searchString, searchString + debugCode);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('✓ Added debug logging to index.js');
      errorsFixed++;
    } else {
      console.log('⚠️  Bootstrap initialization log not found, skipping debug logging addition');
    }
  } catch (error) {
    console.error('✗ Failed to add debug logging:', error.message);
    errorsFound++;
  }
}

// Fix 3: Create templates directory if missing
function ensureTemplatesDirectory() {
  const templatesDir = path.join(__dirname, 'src/main/templates');

  try {
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
      console.log('✓ Created missing templates directory');

      // Create basic category directories
      const categories = ['medical', 'legal', 'education', 'writing', 'ppt', 'excel'];
      for (const category of categories) {
        const categoryPath = path.join(templatesDir, category);
        if (!fs.existsSync(categoryPath)) {
          fs.mkdirSync(categoryPath, { recursive: true });
        }
      }
      console.log('✓ Created basic category directories');
      errorsFixed++;
    } else {
      console.log('✓ Templates directory exists');
    }
  } catch (error) {
    console.error('✗ Failed to create templates directory:', error.message);
    errorsFound++;
  }
}

// Fix 4: Verify data directory exists
function ensureDataDirectory() {
  const dataDir = path.join(__dirname, '../../data');

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log('✓ Created missing data directory');
      errorsFixed++;
    } else {
      console.log('✓ Data directory exists');

      // Check if database exists
      const dbPath = path.join(dataDir, 'chainlesschain.db');
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        console.log(`  Database size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      } else {
        console.log('  ℹ️  Database will be created on first run');
      }
    }
  } catch (error) {
    console.error('✗ Failed to check data directory:', error.message);
    errorsFound++;
  }
}

// Run all fixes
console.log('Running automatic fixes...\n');

fixAutomationRules();
addDebugLogging();
ensureTemplatesDirectory();
ensureDataDirectory();

console.log('');
console.log('='.repeat(60));
console.log(`Summary: ${errorsFixed} issues fixed, ${errorsFound} errors encountered`);
console.log('='.repeat(60));
console.log('');
console.log('Next steps:');
console.log('1. Run: npm run build:main');
console.log('2. Run: npm run dev');
console.log('3. Check console for initialization logs');
console.log('');
console.log('If issues persist, see ERROR_FIX_GUIDE.md for detailed troubleshooting');
