const js = require('@eslint/js');
const pluginVue = require('eslint-plugin-vue');
const globals = require('globals');

module.exports = [
  // 忽略目录
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'out/**',
      'build/**',
      '*.min.js',
      'coverage/**',
    ],
  },

  // JavaScript 基础规则
  js.configs.recommended,

  // Vue 推荐规则
  ...pluginVue.configs['flat/recommended'],

  // 全局配置
  {
    files: ['**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // Vue.js 规则
      'vue/multi-word-component-names': 'warn',
      'vue/no-unused-vars': 'warn',
      'vue/no-v-html': 'warn',
      'vue/require-default-prop': 'warn',
      'vue/require-prop-types': 'warn',
      'vue/valid-v-slot': 'warn',

      // JavaScript 规则
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-undef': 'error',
      'no-unreachable': 'warn',
      'no-constant-condition': 'warn',

      // 代码质量
      'prefer-const': 'warn',
      'no-var': 'warn',
      'eqeqeq': ['warn', 'smart'],
      'curly': ['warn', 'all'],
      'no-throw-literal': 'warn',

      // 安全相关
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },

  // 主进程文件特殊配置
  {
    files: ['src/main/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },

  // 渲染进程文件特殊配置
  {
    files: ['src/renderer/**/*.{js,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        defineProps: 'readonly',
        defineEmits: 'readonly',
        defineExpose: 'readonly',
        withDefaults: 'readonly',
      },
    },
  },

  // 测试文件特殊配置
  {
    files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.mocha,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
