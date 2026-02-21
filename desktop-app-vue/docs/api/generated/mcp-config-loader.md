# mcp-config-loader

**Source**: `src/main/mcp/mcp-config-loader.js`

**Generated**: 2026-02-21T20:04:16.235Z

---

## const

```javascript
const
```

* MCP Configuration Loader
 *
 * Loads and manages MCP configuration from .chainlesschain/config.json
 * Supports hot-reload and validation.
 *
 * @module MCPConfigLoader

---

## load(watch = false)

```javascript
load(watch = false)
```

* Load configuration from file
   * @param {boolean} watch - Enable file watching for hot-reload
   * @returns {Object} MCP configuration

---

## getConfig()

```javascript
getConfig()
```

* Get current configuration
   * @returns {Object} MCP configuration

---

## getServerConfig(serverName)

```javascript
getServerConfig(serverName)
```

* Get configuration for a specific server
   * @param {string} serverName - Server identifier
   * @returns {Object|null} Server configuration

---

## getEnabledServers()

```javascript
getEnabledServers()
```

* Get list of enabled servers
   * @returns {string[]} Array of enabled server names

---

## reload()

```javascript
reload()
```

* Reload configuration from file
   * @returns {Object} Updated configuration

---

## stopWatching()

```javascript
stopWatching()
```

* Stop watching configuration file

---

## _resolveConfigPath()

```javascript
_resolveConfigPath()
```

* Resolve config path by reusing the UnifiedConfigManager's directory.
   * Falls back to the project root when the manager is unavailable.
   * @private

---

## _getDefaultConfig()

```javascript
_getDefaultConfig()
```

* Get default configuration
   * @private

---

## _validateConfig(config)

```javascript
_validateConfig(config)
```

* Validate configuration structure
   * @private

---

## _validateServerConfig(serverName, config)

```javascript
_validateServerConfig(serverName, config)
```

* Validate server configuration
   * @private

---

## _setupWatcher()

```javascript
_setupWatcher()
```

* Setup file watcher for hot-reload
   * @private

---

## _detectChanges(oldConfig, newConfig)

```javascript
_detectChanges(oldConfig, newConfig)
```

* Detect changes between old and new config
   * @private

---

