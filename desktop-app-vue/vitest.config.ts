import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{js,ts}', 'src/**/*.test.{js,ts}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '.idea',
      '.git',
      '.cache',
      // E2E tests use Playwright, not Vitest
      '**/tests/e2e/**',
      '**/e2e/**',
      '**/*.e2e.test.{js,ts}',
      '**/*.spec.{js,ts}',
      // Blockchain tests use chai/mocha, run with node directly
      '**/tests/blockchain/**',
      // These are standalone scripts that use process.exit()
      '**/speech-manager-integration.test.js',
      '**/pkcs11-encryption.test.js'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        '**/dist',
        '**/out'
      ],
      include: ['src/**/*.{js,ts,vue}'],
      all: true,
      lines: 70,
      functions: 70,
      branches: 70,
      statements: 70
    },
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 10000,
    hookTimeout: 10000
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@preload': resolve(__dirname, 'src/preload')
    }
  }
});
