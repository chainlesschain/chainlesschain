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
      // IPC tests use sinon/chai, not compatible with vitest
      '**/tests/ipc/**',
      // Integration tests that use Playwright
      '**/tests/integration/pc-features.test.js',
      '**/tests/integration/p2p-call.test.js',
      // These are standalone scripts that use process.exit()
      '**/speech-manager-integration.test.js',
      '**/pkcs11-encryption.test.js',
      // Video engine tests require real ffmpeg binary and video files (integration test)
      '**/tests/unit/video-engine.test.js',
      // Tests that depend on renderer logger which uses @/utils/logger (doesn't exist)
      '**/tests/unit/planning-store.test.js',
      '**/tests/unit/PythonExecutionPanel.test.ts',
      '**/tests/unit/multimedia/multimedia-api.test.ts',
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
    // 增加超时时间，避免Worker超时错误
    testTimeout: 60000,       // 60秒
    hookTimeout: 60000,       // 60秒
    teardownTimeout: 10000,   // 10秒
    server: {
      deps: {
        // Inline these modules to properly handle CommonJS/ESM interop
        inline: [
          'electron',
          /src\/main\/.*/  // Inline main process modules (CommonJS)
        ]
      }
    },
    // Enable CommonJS interop for main process modules
    deps: {
      interopDefault: true
    }
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@preload': resolve(__dirname, 'src/preload'),
      'electron': resolve(__dirname, 'tests/__mocks__/electron.ts')
    }
  }
});
