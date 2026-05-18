/**
 * MCP Server Builder
 *
 * Provides a fluent API for constructing MCP servers with tools, resources,
 * and prompts. Supports both HTTP+SSE and stdio transports.
 *
 * The builder pattern allows declarative server configuration with
 * validation and sensible defaults.
 *
 * @module mcp/sdk/server-builder
 *
 * @example
 * const server = new MCPServerBuilder()
 *   .name('my-server')
 *   .version('1.0.0')
 *   .description('My custom MCP server')
 *   .tool('calculator', 'Perform calculations', {
 *     expression: { type: 'string', required: true }
 *   }, async (params) => {
 *     return { result: params.expression };
 *   })
 *   .tool('file_reader', 'Read files', {
 *     path: { type: 'string', required: true }
 *   }, async (params) => {
 *     return { content: 'file content here' };
 *   })
 *   .resource('config', 'Application configuration', async () => {
 *     return { data: { key: 'value' } };
 *   })
 *   .prompt('code-review', 'Review code', async (params) => {
 *     return { messages: [{ role: 'user', content: `Review: ${params.code}` }] };
 *   })
 *   .build();
 */

const { logger } = require('../../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

/**
 * Default configuration values for the builder
 * @constant
 */
const BUILDER_DEFAULTS = {
  name: 'chainlesschain-mcp-server',
  version: '1.0.0',
  description: '',
  transport: 'http-sse',
  port: 3100,
  auth: null,
};

/**
 * Supported transport types
 * @constant
 */
const TRANSPORT_TYPES = {
  HTTP_SSE: 'http-sse',
  STDIO: 'stdio',
};

/**
 * Supported parameter types in tool input schemas
 * @constant
 */
const PARAM_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
];

/**
 * @typedef {Object} ToolDefinition
 * @property {string} name - Unique tool name
 * @property {string} description - Human-readable description
 * @property {Object} inputSchema - JSON Schema for tool parameters
 * @property {Function} handler - Async function to execute the tool
 */

/**
 * @typedef {Object} ResourceDefinition
 * @property {string} uri - Unique resource URI
 * @property {string} description - Human-readable description
 * @property {string} [mimeType] - MIME type of the resource content
 * @property {Function} handler - Async function to read the resource
 */

/**
 * @typedef {Object} PromptDefinition
 * @property {string} name - Unique prompt name
 * @property {string} description - Human-readable description
 * @property {Object[]} [arguments] - Prompt argument definitions
 * @property {Function} handler - Async function to generate the prompt
 */

/**
 * @typedef {Object} AuthConfig
 * @property {string} type - Authentication type: 'bearer', 'api-key', 'basic', 'custom'
 * @property {string} [token] - Static bearer token
 * @property {string} [apiKey] - Static API key
 * @property {string} [username] - Basic auth username
 * @property {string} [password] - Basic auth password
 * @property {Function} [validate] - Custom validation function: (req) => boolean
 */

/**
 * @typedef {Object} BuilderConfig
 * @property {string} name - Server name
 * @property {string} version - Server version
 * @property {string} description - Server description
 * @property {string} transport - Transport type: 'http-sse' or 'stdio'
 * @property {number} port - HTTP port (for http-sse transport)
 * @property {AuthConfig} auth - Authentication configuration
 * @property {ToolDefinition[]} tools - Registered tools
 * @property {ResourceDefinition[]} resources - Registered resources
 * @property {PromptDefinition[]} prompts - Registered prompts
 */

/**
 * Fluent API builder for creating MCP servers.
 *
 * Provides a chainable interface for configuring server metadata,
 * registering tools/resources/prompts, and selecting transport layer.
 */
class MCPServerBuilder {
  /**
   * Create a new MCPServerBuilder instance
   */
  constructor() {
    /** @type {string} Server identifier */
    this._id = uuidv4();

    /** @type {string} Server name */
    this._name = BUILDER_DEFAULTS.name;

    /** @type {string} Server version */
    this._version = BUILDER_DEFAULTS.version;

    /** @type {string} Server description */
    this._description = BUILDER_DEFAULTS.description;

    /** @type {string} Transport type */
    this._transport = BUILDER_DEFAULTS.transport;

    /** @type {number} HTTP port */
    this._port = BUILDER_DEFAULTS.port;

    /** @type {AuthConfig|null} Authentication config */
    this._auth = BUILDER_DEFAULTS.auth;

    /** @type {Map<string, ToolDefinition>} Registered tools */
    this._tools = new Map();

    /** @type {Map<string, ResourceDefinition>} Registered resources */
    this._resources = new Map();

    /** @type {Map<string, PromptDefinition>} Registered prompts */
    this._prompts = new Map();

    /** @type {Object} Additional middleware */
    this._middleware = [];

    /** @type {Object} Event hooks */
    this._hooks = {
      onStart: [],
      onStop: [],
      onError: [],
      onToolCall: [],
      onResourceRead: [],
      onPromptGet: [],
    };

    logger.info(`[MCPServerBuilder] Created builder instance: ${this._id}`);
  }

  // ===================================
  // Configuration Methods (Fluent API)
  // ===================================

  /**
   * Set the server name
   * @param {string} serverName - Human-readable server name
   * @returns {MCPServerBuilder} this instance for chaining
   */
  name(serverName) {
    if (!serverName || typeof serverName !== 'string') {
      throw new Error('Server name must be a non-empty string');
    }

    if (serverName.length > 128) {
      throw new Error('Server name must be 128 characters or fewer');
    }

    // Validate name format: alphanumeric, hyphens, underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(serverName)) {
      throw new Error(
        'Server name must contain only alphanumeric characters, hyphens, and underscores'
      );
    }

    this._name = serverName;
    return this;
  }

  /**
   * Set the server version
   * @param {string} serverVersion - Semantic version string (e.g., '1.0.0')
   * @returns {MCPServerBuilder} this instance for chaining
   */
  version(serverVersion) {
    if (!serverVersion || typeof serverVersion !== 'string') {
      throw new Error('Version must be a non-empty string');
    }

    // Validate semver-like format (loose)
    if (!/^\d+\.\d+(\.\d+)?(-[\w.]+)?(\+[\w.]+)?$/.test(serverVersion)) {
      throw new Error(
        'Version must follow semantic versioning (e.g., "1.0.0", "2.1.0-beta")'
      );
    }

    this._version = serverVersion;
    return this;
  }

  /**
   * Set the server description
   * @param {string} desc - Human-readable description of the server
   * @returns {MCPServerBuilder} this instance for chaining
   */
  description(desc) {
    if (typeof desc !== 'string') {
      throw new Error('Description must be a string');
    }

    if (desc.length > 1024) {
      throw new Error('Description must be 1024 characters or fewer');
    }

    this._description = desc;
    return this;
  }

  /**
   * Register a tool with the server
   *
   * Tools are callable functions that the AI can invoke. Each tool must
   * have a unique name, a description, an input schema, and a handler.
   *
   * @param {string} toolName - Unique tool name
   * @param {string} toolDescription - Human-readable description
   * @param {Object} inputSchema - Parameter definitions (simplified or JSON Schema)
   * @param {Function} handler - Async function: (params) => result
   * @returns {MCPServerBuilder} this instance for chaining
   *
   * @example
   * builder.tool('add', 'Add two numbers', {
   *   a: { type: 'number', required: true, description: 'First number' },
   *   b: { type: 'number', required: true, description: 'Second number' },
   * }, async (params) => {
   *   return { sum: params.a + params.b };
   * });
   */
  tool(toolName, toolDescription, inputSchema, handler) {
    // Validate tool name
    if (!toolName || typeof toolName !== 'string') {
      throw new Error('Tool name must be a non-empty string');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(toolName)) {
      throw new Error(
        `Tool name "${toolName}" must contain only alphanumeric characters, hyphens, and underscores`
      );
    }

    // Check for duplicate tool names
    if (this._tools.has(toolName)) {
      throw new Error(
        `Tool "${toolName}" is already registered. Use a unique name for each tool.`
      );
    }

    // Validate description
    if (!toolDescription || typeof toolDescription !== 'string') {
      throw new Error(`Tool "${toolName}" must have a non-empty string description`);
    }

    // Validate handler
    if (typeof handler !== 'function') {
      throw new Error(`Tool "${toolName}" handler must be a function`);
    }

    // Convert simplified schema to JSON Schema format
    const jsonSchema = this._convertToJsonSchema(inputSchema, toolName);

    // Register the tool
    this._tools.set(toolName, {
      name: toolName,
      description: toolDescription,
      inputSchema: jsonSchema,
      handler,
    });

    logger.info(`[MCPServerBuilder] Registered tool: ${toolName}`);

    return this;
  }

  /**
   * Register a resource with the server
   *
   * Resources are read-only data sources that can be accessed by URI.
   *
   * @param {string} uri - Unique resource URI
   * @param {string} resourceDescription - Human-readable description
   * @param {Function} handler - Async function: () => { data, mimeType? }
   * @param {Object} [options] - Additional resource options
   * @param {string} [options.mimeType] - MIME type of the resource
   * @returns {MCPServerBuilder} this instance for chaining
   *
   * @example
   * builder.resource('config://app', 'Application configuration', async () => {
   *   return { data: { theme: 'dark', language: 'en' } };
   * });
   */
  resource(uri, resourceDescription, handler, options = {}) {
    // Validate URI
    if (!uri || typeof uri !== 'string') {
      throw new Error('Resource URI must be a non-empty string');
    }

    // Check for duplicate URIs
    if (this._resources.has(uri)) {
      throw new Error(
        `Resource "${uri}" is already registered. Use a unique URI for each resource.`
      );
    }

    // Validate description
    if (!resourceDescription || typeof resourceDescription !== 'string') {
      throw new Error(`Resource "${uri}" must have a non-empty string description`);
    }

    // Validate handler
    if (typeof handler !== 'function') {
      throw new Error(`Resource "${uri}" handler must be a function`);
    }

    // Register the resource
    this._resources.set(uri, {
      uri,
      name: uri,
      description: resourceDescription,
      mimeType: options.mimeType || 'application/json',
      handler,
    });

    logger.info(`[MCPServerBuilder] Registered resource: ${uri}`);

    return this;
  }

  /**
   * Register a prompt with the server
   *
   * Prompts are reusable prompt templates that can be parameterized.
   *
   * @param {string} promptName - Unique prompt name
   * @param {string} promptDescription - Human-readable description
   * @param {Function} handler - Async function: (params) => { messages: [...] }
   * @param {Object} [options] - Additional prompt options
   * @param {Object[]} [options.arguments] - Prompt argument definitions
   * @returns {MCPServerBuilder} this instance for chaining
   *
   * @example
   * builder.prompt('code-review', 'Review code for issues', async (params) => {
   *   return {
   *     messages: [
   *       { role: 'user', content: `Please review this code:\n${params.code}` }
   *     ]
   *   };
   * }, {
   *   arguments: [
   *     { name: 'code', description: 'Code to review', required: true }
   *   ]
   * });
   */
  prompt(promptName, promptDescription, handler, options = {}) {
    // Validate name
    if (!promptName || typeof promptName !== 'string') {
      throw new Error('Prompt name must be a non-empty string');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(promptName)) {
      throw new Error(
        `Prompt name "${promptName}" must contain only alphanumeric characters, hyphens, and underscores`
      );
    }

    // Check for duplicate names
    if (this._prompts.has(promptName)) {
      throw new Error(
        `Prompt "${promptName}" is already registered. Use a unique name for each prompt.`
      );
    }

    // Validate description
    if (!promptDescription || typeof promptDescription !== 'string') {
      throw new Error(`Prompt "${promptName}" must have a non-empty string description`);
    }

    // Validate handler
    if (typeof handler !== 'function') {
      throw new Error(`Prompt "${promptName}" handler must be a function`);
    }

    // Register the prompt
    this._prompts.set(promptName, {
      name: promptName,
      description: promptDescription,
      arguments: options.arguments || [],
      handler,
    });

    logger.info(`[MCPServerBuilder] Registered prompt: ${promptName}`);

    return this;
  }

  /**
   * Set the transport type
   *
   * @param {string} type - Transport type: 'http-sse' or 'stdio'
   * @returns {MCPServerBuilder} this instance for chaining
   */
  transport(type) {
    if (!Object.values(TRANSPORT_TYPES).includes(type)) {
      throw new Error(
        `Invalid transport type "${type}". Must be one of: ${Object.values(TRANSPORT_TYPES).join(', ')}`
      );
    }

    this._transport = type;
    return this;
  }

  /**
   * Set the HTTP port (only applicable for http-sse transport)
   *
   * @param {number} portNumber - Port number (1024-65535)
   * @returns {MCPServerBuilder} this instance for chaining
   */
  port(portNumber) {
    if (typeof portNumber !== 'number' || !Number.isInteger(portNumber)) {
      throw new Error('Port must be an integer');
    }

    if (portNumber < 1 || portNumber > 65535) {
      throw new Error('Port must be between 1 and 65535');
    }

    if (portNumber < 1024) {
      logger.warn(
        `[MCPServerBuilder] Using privileged port ${portNumber}. Consider using a port >= 1024.`
      );
    }

    this._port = portNumber;
    return this;
  }

  /**
   * Set authentication configuration
   *
   * @param {AuthConfig} config - Authentication configuration
   * @returns {MCPServerBuilder} this instance for chaining
   *
   * @example
   * // Bearer token auth
   * builder.auth({ type: 'bearer', token: 'my-secret-token' });
   *
   * // API key auth
   * builder.auth({ type: 'api-key', apiKey: 'my-api-key' });
   *
   * // Basic auth
   * builder.auth({ type: 'basic', username: 'user', password: 'pass' });
   *
   * // Custom validation function
   * builder.auth({ type: 'custom', validate: (req) => req.headers['x-token'] === 'secret' });
   */
  auth(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Auth config must be an object');
    }

    const validTypes = ['bearer', 'api-key', 'basic', 'custom'];
    if (!validTypes.includes(config.type)) {
      throw new Error(
        `Invalid auth type "${config.type}". Must be one of: ${validTypes.join(', ')}`
      );
    }

    // Validate auth config based on type
    switch (config.type) {
      case 'bearer':
        if (!config.token || typeof config.token !== 'string') {
          throw new Error('Bearer auth requires a non-empty "token" string');
        }
        break;

      case 'api-key':
        if (!config.apiKey || typeof config.apiKey !== 'string') {
          throw new Error('API key auth requires a non-empty "apiKey" string');
        }
        break;

      case 'basic':
        if (!config.username || !config.password) {
          throw new Error('Basic auth requires "username" and "password"');
        }
        break;

      case 'custom':
        if (typeof config.validate !== 'function') {
          throw new Error('Custom auth requires a "validate" function');
        }
        break;
    }

    this._auth = config;
    return this;
  }

  /**
   * Add middleware to the server pipeline
   *
   * Middleware functions are called before each request handler.
   * They can modify the request, add context, or reject the request.
   *
   * @param {Function} middlewareFn - Middleware function: (req, next) => result
   * @returns {MCPServerBuilder} this instance for chaining
   */
  use(middlewareFn) {
    if (typeof middlewareFn !== 'function') {
      throw new Error('Middleware must be a function');
    }

    this._middleware.push(middlewareFn);
    return this;
  }

  /**
   * Register an event hook
   *
   * @param {string} event - Hook event name (onStart, onStop, onError, onToolCall, onResourceRead, onPromptGet)
   * @param {Function} hookFn - Hook function
   * @returns {MCPServerBuilder} this instance for chaining
   */
  hook(event, hookFn) {
    if (!this._hooks[event]) {
      throw new Error(
        `Unknown hook event "${event}". Available: ${Object.keys(this._hooks).join(', ')}`
      );
    }

    if (typeof hookFn !== 'function') {
      throw new Error(`Hook handler for "${event}" must be a function`);
    }

    this._hooks[event].push(hookFn);
    return this;
  }

  // ===================================
  // Build & Validation
  // ===================================

  /**
   * Validate the current builder configuration
   *
   * Checks that all required fields are set and all registrations are
   * internally consistent. Throws descriptive errors for any issues found.
   *
   * @returns {Object} Validation result with details
   * @throws {Error} If validation fails
   */
  validate() {
    const errors = [];
    const warnings = [];

    // Validate server metadata
    if (!this._name || this._name === BUILDER_DEFAULTS.name) {
      warnings.push('Server name is using the default value. Consider setting a custom name.');
    }

    if (!this._version) {
      errors.push('Server version is required');
    }

    // Validate at least one capability is registered
    if (this._tools.size === 0 && this._resources.size === 0 && this._prompts.size === 0) {
      warnings.push(
        'No tools, resources, or prompts registered. The server will have no capabilities.'
      );
    }

    // Validate transport-specific config
    if (this._transport === TRANSPORT_TYPES.HTTP_SSE) {
      if (!this._port) {
        errors.push('HTTP port is required for http-sse transport');
      }
    }

    // Validate tools
    for (const [toolName, toolDef] of this._tools) {
      if (!toolDef.inputSchema || typeof toolDef.inputSchema !== 'object') {
        errors.push(`Tool "${toolName}" has an invalid input schema`);
      }

      if (!toolDef.handler || typeof toolDef.handler !== 'function') {
        errors.push(`Tool "${toolName}" has an invalid handler`);
      }
    }

    // Validate resources
    for (const [uri, resourceDef] of this._resources) {
      if (!resourceDef.handler || typeof resourceDef.handler !== 'function') {
        errors.push(`Resource "${uri}" has an invalid handler`);
      }
    }

    // Validate prompts
    for (const [promptName, promptDef] of this._prompts) {
      if (!promptDef.handler || typeof promptDef.handler !== 'function') {
        errors.push(`Prompt "${promptName}" has an invalid handler`);
      }
    }

    // Validate auth config consistency
    if (this._auth && this._transport === TRANSPORT_TYPES.STDIO) {
      warnings.push(
        'Authentication is configured but stdio transport does not support it. Auth will be ignored.'
      );
    }

    const isValid = errors.length === 0;

    const result = {
      valid: isValid,
      errors,
      warnings,
      summary: {
        name: this._name,
        version: this._version,
        transport: this._transport,
        toolCount: this._tools.size,
        resourceCount: this._resources.size,
        promptCount: this._prompts.size,
        hasAuth: this._auth !== null,
        middlewareCount: this._middleware.length,
      },
    };

    if (!isValid) {
      const errorMessage = `Server configuration validation failed:\n  - ${errors.join('\n  - ')}`;
      logger.error(`[MCPServerBuilder] ${errorMessage}`);
      throw new Error(errorMessage);
    }

    if (warnings.length > 0) {
      logger.warn(
        `[MCPServerBuilder] Validation warnings:\n  - ${warnings.join('\n  - ')}`
      );
    }

    logger.info(
      `[MCPServerBuilder] Validation passed: ${this._tools.size} tools, ` +
        `${this._resources.size} resources, ${this._prompts.size} prompts`
    );

    return result;
  }

  /**
   * Build and return the configured MCP server instance
   *
   * Validates the configuration and creates either an MCPHttpServer
   * or MCPStdioServer based on the transport setting.
   *
   * @returns {MCPHttpServer|MCPStdioServer} Configured server instance
   * @throws {Error} If validation fails
   */
  build() {
    logger.info(`[MCPServerBuilder] Building server "${this._name}" v${this._version}...`);

    // Run validation
    this.validate();

    // Prepare the server configuration
    const serverConfig = {
      name: this._name,
      version: this._version,
      description: this._description,
      tools: this._tools,
      resources: this._resources,
      prompts: this._prompts,
      middleware: this._middleware,
      hooks: this._hooks,
      auth: this._auth,
    };

    let server;

    if (this._transport === TRANSPORT_TYPES.HTTP_SSE) {
      // Build HTTP+SSE server
      const { MCPHttpServer } = require('./http-server');

      server = new MCPHttpServer({
        ...serverConfig,
        port: this._port,
      });

      logger.info(
        `[MCPServerBuilder] Built HTTP+SSE server on port ${this._port}`
      );
    } else {
      // Build stdio server
      const { MCPStdioServer } = require('./stdio-server');

      server = new MCPStdioServer(serverConfig);

      logger.info('[MCPServerBuilder] Built stdio server');
    }

    logger.info(
      `[MCPServerBuilder] Server "${this._name}" v${this._version} ready ` +
        `(${this._tools.size} tools, ${this._resources.size} resources, ${this._prompts.size} prompts)`
    );

    return server;
  }

  // ===================================
  // Utility Methods
  // ===================================

  /**
   * Get the current builder configuration as a plain object
   *
   * @returns {BuilderConfig} Current configuration
   */
  getConfig() {
    return {
      id: this._id,
      name: this._name,
      version: this._version,
      description: this._description,
      transport: this._transport,
      port: this._port,
      auth: this._auth ? { type: this._auth.type } : null,
      tools: Array.from(this._tools.keys()),
      resources: Array.from(this._resources.keys()),
      prompts: Array.from(this._prompts.keys()),
      middlewareCount: this._middleware.length,
    };
  }

  /**
   * Reset the builder to default state
   *
   * @returns {MCPServerBuilder} this instance for chaining
   */
  reset() {
    this._id = uuidv4();
    this._name = BUILDER_DEFAULTS.name;
    this._version = BUILDER_DEFAULTS.version;
    this._description = BUILDER_DEFAULTS.description;
    this._transport = BUILDER_DEFAULTS.transport;
    this._port = BUILDER_DEFAULTS.port;
    this._auth = BUILDER_DEFAULTS.auth;
    this._tools = new Map();
    this._resources = new Map();
    this._prompts = new Map();
    this._middleware = [];
    this._hooks = {
      onStart: [],
      onStop: [],
      onError: [],
      onToolCall: [],
      onResourceRead: [],
      onPromptGet: [],
    };

    logger.info(`[MCPServerBuilder] Builder reset: ${this._id}`);
    return this;
  }

  /**
   * Clone the builder with all current configuration
   *
   * @returns {MCPServerBuilder} New builder instance with same configuration
   */
  clone() {
    const cloned = new MCPServerBuilder();
    cloned._name = this._name;
    cloned._version = this._version;
    cloned._description = this._description;
    cloned._transport = this._transport;
    cloned._port = this._port;
    cloned._auth = this._auth ? { ...this._auth } : null;
    cloned._tools = new Map(this._tools);
    cloned._resources = new Map(this._resources);
    cloned._prompts = new Map(this._prompts);
    cloned._middleware = [...this._middleware];
    cloned._hooks = {
      onStart: [...this._hooks.onStart],
      onStop: [...this._hooks.onStop],
      onError: [...this._hooks.onError],
      onToolCall: [...this._hooks.onToolCall],
      onResourceRead: [...this._hooks.onResourceRead],
      onPromptGet: [...this._hooks.onPromptGet],
    };

    logger.info(
      `[MCPServerBuilder] Cloned builder ${this._id} -> ${cloned._id}`
    );
    return cloned;
  }

  // ===================================
  // Private Helpers
  // ===================================

  /**
   * Convert a simplified parameter schema to full JSON Schema format
   *
   * Accepts both simplified format (used in builder API) and standard
   * JSON Schema format (passed through unchanged).
   *
   * @private
   * @param {Object} schema - Simplified or JSON Schema parameter definitions
   * @param {string} context - Context string for error messages (e.g., tool name)
   * @returns {Object} Valid JSON Schema object
   *
   * @example
   * // Simplified format input:
   * {
   *   name: { type: 'string', required: true, description: 'User name' },
   *   age: { type: 'number', description: 'User age' }
   * }
   *
   * // Output:
   * {
   *   type: 'object',
   *   properties: {
   *     name: { type: 'string', description: 'User name' },
   *     age: { type: 'number', description: 'User age' }
   *   },
   *   required: ['name']
   * }
   */
  _convertToJsonSchema(schema, context) {
    // If schema is null/undefined, return empty schema
    if (!schema) {
      return {
        type: 'object',
        properties: {},
        required: [],
      };
    }

    // If it already looks like a JSON Schema (has 'type' at root level
    // and 'properties'), pass it through with minimal validation
    if (schema.type === 'object' && schema.properties) {
      return {
        type: 'object',
        properties: schema.properties,
        required: schema.required || [],
      };
    }

    // Convert simplified format to JSON Schema
    const properties = {};
    const required = [];

    for (const [paramName, paramDef] of Object.entries(schema)) {
      if (typeof paramDef === 'string') {
        // Simple type specification: { name: 'string' }
        if (!PARAM_TYPES.includes(paramDef)) {
          throw new Error(
            `[${context}] Invalid parameter type "${paramDef}" for "${paramName}". ` +
              `Must be one of: ${PARAM_TYPES.join(', ')}`
          );
        }
        properties[paramName] = { type: paramDef };
      } else if (typeof paramDef === 'object' && paramDef !== null) {
        // Full parameter definition
        const { type, required: isRequired, description: paramDesc, ...rest } = paramDef;

        if (type && !PARAM_TYPES.includes(type)) {
          throw new Error(
            `[${context}] Invalid parameter type "${type}" for "${paramName}". ` +
              `Must be one of: ${PARAM_TYPES.join(', ')}`
          );
        }

        const property = {};

        if (type) {
          property.type = type;
        }

        if (paramDesc) {
          property.description = paramDesc;
        }

        // Copy through any additional JSON Schema properties
        // (enum, default, minimum, maximum, pattern, items, etc.)
        for (const [key, value] of Object.entries(rest)) {
          property[key] = value;
        }

        properties[paramName] = property;

        if (isRequired) {
          required.push(paramName);
        }
      } else {
        throw new Error(
          `[${context}] Invalid parameter definition for "${paramName}". ` +
            'Must be a type string or an object with { type, required?, description? }'
        );
      }
    }

    return {
      type: 'object',
      properties,
      required,
    };
  }
}

module.exports = { MCPServerBuilder, TRANSPORT_TYPES, BUILDER_DEFAULTS, PARAM_TYPES };
