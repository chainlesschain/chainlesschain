/**
 * Transparent proxy for Node.js 'http' built-in.
 * This allows Vite to resolve 'http' imports by redirecting to 'node:http'.
 * Vite externalizes 'node:' protocol imports automatically.
 */
export * from 'node:http';
export { default } from 'node:http';
