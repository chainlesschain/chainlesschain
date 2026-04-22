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
      "scripts/**",
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
      // Every existing v-html site is sanitized (safeHtml / renderMarkdown
      // / DOMPurify / escapeHtml); new usage must either route through one
      // of those or carry an explicit `eslint-disable-next-line` with a
      // justification. See AUDIT_2026-04-22.md §3.
      "vue/no-v-html": "error",
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
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },

  // 主进程文件特殊配置（在 tseslint 之后覆盖，确保优先级）
  {
    files: ["src/main/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-undef": "off",
      "no-redeclare": "off",
      "no-global-assign": "warn",
      "no-case-declarations": "warn",
      "no-inner-declarations": "warn",
      "no-empty": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-this-alias": "warn",
    },
  },

  // Preload 文件特殊配置（CJS require）
  {
    files: ["src/preload/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        require: "readonly",
        module: "readonly",
        exports: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-undef": "off",
    },
  },

  // Worker 文件特殊配置
  {
    files: ["src/renderer/workers/**/*.js"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
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

  // 测试文件特殊配置（在 tseslint 之后覆盖）
  {
    files: ["tests/**/*.js", "**/*.test.js", "**/*.spec.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.jest,
        ...globals.mocha,
        ...globals.node,
        vi: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-redeclare": "off",
    },
  },
];
