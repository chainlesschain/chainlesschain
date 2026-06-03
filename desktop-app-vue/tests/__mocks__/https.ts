/**
 * Transparent proxy for Node.js 'https' built-in.
 * This allows Vite to resolve 'https' imports by redirecting to 'node:https'.
 * Vite externalizes 'node:' protocol imports automatically.
 */
export * from 'node:https';
export { default } from 'node:https';
