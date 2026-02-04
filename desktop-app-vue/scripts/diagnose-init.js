/**
 * Diagnostic script to check bootstrap initialization
 * Run this to identify which modules are failing to initialize
 */

const path = require('path');
const { app } = require('electron');

// Mock electron app for testing
if (!app.getPath) {
  app.getPath = (name) => {
    if (name === 'userData') {
      return path.join(process.cwd(), 'data');
    }
    return process.cwd();
  };
  app.isReady = () => true;
}

// Set test environment
process.env.NODE_ENV = 'development';
process.env.DEFAULT_PASSWORD = '123456';

const { bootstrapApplication } = require('../dist/main/bootstrap');
const { logger } = require('../dist/main/utils/logger.js');

async function diagnose() {
  logger.info('='.repeat(60));
  logger.info('Starting Bootstrap Diagnostic...');
  logger.info('='.repeat(60));

  try {
    const instances = await bootstrapApplication({
      progressCallback: (message, progress) => {
        console.log(`[${progress.toFixed(0)}%] ${message}`);
      },
      context: { mainWindow: null }
    });

    logger.info('\n' + '='.repeat(60));
    logger.info('Bootstrap Diagnostic Results:');
    logger.info('='.repeat(60));

    // Check critical modules
    const criticalModules = [
      'database',
      'templateManager',
      'organizationManager',
      'didManager',
      'p2pManager',
      'llmManager',
      'ragManager'
    ];

    let failedModules = [];
    let succeededModules = [];

    for (const moduleName of criticalModules) {
      if (instances[moduleName]) {
        succeededModules.push(moduleName);
        logger.info(`✓ ${moduleName}: Initialized`);
      } else {
        failedModules.push(moduleName);
        logger.error(`✗ ${moduleName}: FAILED`);
      }
    }

    logger.info('\n' + '='.repeat(60));
    logger.info(`Summary: ${succeededModules.length}/${criticalModules.length} modules initialized`);
    logger.info('='.repeat(60));

    if (failedModules.length > 0) {
      logger.error('\nFailed modules:');
      failedModules.forEach(m => logger.error(`  - ${m}`));
      process.exit(1);
    } else {
      logger.info('\n✓ All critical modules initialized successfully!');
      process.exit(0);
    }

  } catch (error) {
    logger.error('Bootstrap diagnostic failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

diagnose();
