/**
 * Headless bootstrap - initializes core packages without GUI modules.
 *
 * Stages:
 *  1. Environment detection
 *  2. Path resolution
 *  3. Logger setup
 *  4. Configuration loading
 *  5. Database initialization
 *  6. Service container setup
 *  7. Event bus activation
 *  (Stages 8-10 reserved for LLM, AI, and social when extracted)
 */

import { logger } from "../lib/logger.js";

let _context = null;

/**
 * Initialize the headless runtime
 * @param {object} [options]
 * @param {boolean} [options.skipDb] - Skip database initialization
 * @param {string} [options.dbPath] - Custom database path
 * @param {boolean} [options.verbose] - Verbose output
 * @returns {Promise<object>} Runtime context
 */
export async function bootstrap(options = {}) {
  if (_context) return _context;

  const ctx = {
    env: null,
    config: null,
    db: null,
    container: null,
    eventBus: null,
    initialized: false,
  };

  try {
    // Stage 1: Environment
    if (options.verbose) logger.verbose("Stage 1: Detecting environment...");
    const coreEnv = await import("@chainlesschain/core-env");
    ctx.env = {
      runtime: coreEnv.getRuntimeInfo(),
      userDataPath: coreEnv.getUserDataPath(),
      configDir: coreEnv.getConfigDir(),
      dataDir: coreEnv.getDataDir(),
      logsDir: coreEnv.getLogsDir(),
    };

    // Ensure directories exist
    coreEnv.ensureDir(ctx.env.userDataPath);
    coreEnv.ensureDir(ctx.env.configDir);
    coreEnv.ensureDir(ctx.env.dataDir);
    coreEnv.ensureDir(ctx.env.logsDir);

    // Stage 2-3: Logger (shared-logger optional, CLI logger always works)
    if (options.verbose) logger.verbose("Stage 2-3: Logger ready");

    // Stage 4: Configuration
    if (options.verbose) logger.verbose("Stage 4: Loading configuration...");
    try {
      const coreConfig = await import("@chainlesschain/core-config");
      coreConfig.setPathResolvers({
        getUserDataPath: () => ctx.env.userDataPath,
        getDataDir: () => ctx.env.dataDir,
      });
      ctx.config = coreConfig.getAppConfig({
        configPath: `${ctx.env.userDataPath}/app-config.json`,
      });
    } catch (err) {
      if (options.verbose) logger.verbose(`Config package not available: ${err.message}`);
      ctx.config = null;
    }

    // Stage 5: Database
    if (!options.skipDb) {
      if (options.verbose) logger.verbose("Stage 5: Initializing database...");
      try {
        const coreDb = await import("@chainlesschain/core-db");
        const dbPath =
          options.dbPath ||
          (ctx.config
            ? ctx.config.getDatabasePath()
            : `${ctx.env.dataDir}/chainlesschain.db`);

        const dbManager = coreDb.getDatabaseManager();
        await dbManager.initialize({ dbPath });
        ctx.db = dbManager;
      } catch (err) {
        if (options.verbose)
          logger.verbose(`Database init skipped: ${err.message}`);
        ctx.db = null;
      }
    }

    // Stage 6: Service container
    if (options.verbose) logger.verbose("Stage 6: Service container...");
    try {
      const coreInfra = await import("@chainlesschain/core-infra");
      ctx.container = coreInfra.getServiceContainer();
      ctx.eventBus = coreInfra.getEventBus();

      // Register core services
      if (ctx.db) {
        ctx.container.register("database", () => ctx.db, {
          tags: ["core"],
        });
      }
      if (ctx.config) {
        ctx.container.register("config", () => ctx.config, {
          tags: ["core"],
        });
      }
    } catch (err) {
      if (options.verbose)
        logger.verbose(`Infra packages not available: ${err.message}`);
    }

    // Stage 7: Event bus
    if (options.verbose) logger.verbose("Stage 7: Event bus active");

    ctx.initialized = true;
    _context = ctx;

    return ctx;
  } catch (err) {
    logger.error(`Bootstrap failed: ${err.message}`);
    throw err;
  }
}

/**
 * Get the runtime context (must call bootstrap first)
 */
export function getContext() {
  return _context;
}

/**
 * Gracefully shutdown the runtime
 */
export async function shutdown() {
  if (!_context) return;

  try {
    if (_context.db) {
      _context.db.close();
    }
    if (_context.container) {
      await _context.container.disposeAll();
    }
  } catch (err) {
    logger.error(`Shutdown error: ${err.message}`);
  }

  _context = null;
}
