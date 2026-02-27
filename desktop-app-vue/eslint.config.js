const js = require("@eslint/js");
const pluginVue = require("eslint-plugin-vue");
const globals = require("globals");
const tseslint = require("typescript-eslint");
const vueParser = require("vue-eslint-parser");
const tsParser = require("@typescript-eslint/parser");

module.exports = [
  // 忽略目录
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "out/**",
      "build/**",
      "*.min.js",
      "*.config.js",
      "coverage/**",
      "browser-extension/**",
      "src/main/remote/browser-extension/**",
    ],
  },

  // JavaScript 基础规则
  js.configs.recommended,

  // Vue 推荐规则
  ...pluginVue.configs["flat/recommended"],

  // 全局配置
  {
    files: ["**/*.{js,vue}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // Vue.js 规则
      "vue/multi-word-component-names": "warn",
      "vue/no-unused-vars": "warn",
      "vue/no-v-html": "warn",
      "vue/require-default-prop": "warn",
      "vue/require-prop-types": "warn",
      "vue/valid-v-slot": "warn",

      // JavaScript 规则
      "no-console": process.env.NODE_ENV === "production" ? "warn" : "off",
      "no-debugger": process.env.NODE_ENV === "production" ? "error" : "off",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-undef": "error",
      "no-unreachable": "warn",
      "no-constant-condition": "warn",

      // 代码质量
      "prefer-const": "warn",
      "no-var": "warn",
      eqeqeq: ["warn", "smart"],
      curly: ["warn", "all"],
      "no-throw-literal": "warn",

      // 安全相关
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },

  // 主进程文件特殊配置
  {
    files: ["src/main/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      // 主进程使用 CommonJS，允许 require()
      "@typescript-eslint/no-require-imports": "off",
      // 允许使用下划线前缀忽略未使用的变量
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  // 渲染进程文件特殊配置
  {
    files: ["src/renderer/**/*.{js,vue}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        defineProps: "readonly",
        defineEmits: "readonly",
        defineExpose: "readonly",
        withDefaults: "readonly",
      },
    },
  },

  // TypeScript 推荐规则
  ...tseslint.configs.recommended,

  // TypeScript 文件配置
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.vue"],
    ignores: ["eslint.config.js", "*.config.js"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Vue 文件中的 TypeScript 配置
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        parser: tsParser,
        extraFileExtensions: [".vue"],
      },
    },
  },

  // 测试文件特殊配置
  {
    files: ["tests/**/*.js", "**/*.test.js", "**/*.spec.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.mocha,
        vi: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      // 测试文件允许 require()
      "@typescript-eslint/no-require-imports": "off",
      // 测试文件中允许未使用的变量（用于测试 mock）
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
    },
  },
];
