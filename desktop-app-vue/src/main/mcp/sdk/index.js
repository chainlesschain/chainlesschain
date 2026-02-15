/**
 * MCP SDK - Entry Point
 *
 * Provides a developer-friendly SDK for building custom MCP servers.
 * Re-exports all SDK components for convenient access.
 *
 * @module mcp/sdk
 *
 * @example
 * const { MCPServerBuilder, MCPHttpServer, MCPStdioServer } = require('./mcp/sdk');
 *
 * // Quick builder pattern
 * const server = new MCPServerBuilder()
 *   .name('my-server')
 *   .version('1.0.0')
 *   .tool('hello', 'Say hello', { name: { type: 'string' } }, async (params) => {
 *     return { greeting: `Hello, ${params.name}!` };
 *   })
 *   .build();
 *
 * await server.start();
 *
 * // Or use servers directly
 * const httpServer = new MCPHttpServer({ name: 'my-http-server', version: '1.0.0', port: 3100 });
 * const stdioServer = new MCPStdioServer({ name: 'my-stdio-server', version: '1.0.0' });
 */

const { MCPServerBuilder } = require('./server-builder');
const { MCPHttpServer } = require('./http-server');
const { MCPStdioServer } = require('./stdio-server');

module.exports = {
  MCPServerBuilder,
  MCPHttpServer,
  MCPStdioServer,
};
