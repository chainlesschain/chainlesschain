module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    browser: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "prettier", // 必须放在最后，以覆盖其他配置
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ["@typescript-eslint", "react", "react-hooks"],
  rules: {
    // 关闭一些过于严格的规则
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-var-requires": "off", // 项目使用 CommonJS
    "@typescript-eslint/no-this-alias": "warn",
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/ban-types": "warn",
    "no-console": "off",
    "no-debugger": "warn",
    "react/react-in-jsx-scope": "off", // React 17+ 不需要
    "react/prop-types": "off", // 使用 TypeScript
    "react-hooks/rules-of-hooks": "warn", // Downgrade for non-component files
    "no-case-declarations": "warn",
    "no-useless-escape": "warn",
    "no-useless-catch": "warn",
    "no-constant-condition": "warn",
    "no-control-regex": "warn",
    "no-prototype-builtins": "warn",
    "no-async-promise-executor": "warn",
    "no-inner-declarations": "warn",
    "no-unreachable": "warn",
    "no-empty": "warn",
    "no-redeclare": "warn",
    "no-dupe-keys": "warn",
    "no-dupe-class-members": "warn",
    "no-const-assign": "warn",
    "prefer-const": "warn",
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  ignorePatterns: [
    "node_modules/",
    "dist/",
    "out/",
    "build/",
    "coverage/",
    "*.min.js",
    "desktop-app-vue/src/renderer/assets/",
    "backend/",
    "mobile-app-uniapp/",
    "android-app/",
    "ios-app/",
    "examples/", // Example projects have their own tsconfig
    "**/*.vue", // Temporarily ignore Vue files (need vue-eslint-parser)
    "**/*.d.ts", // Ignore TypeScript declaration files
  ],
  overrides: [
    {
      // Browser extension files need webextensions environment for chrome global
      files: ["browser-extension/**/*.js", "**/browser-extension/**/*.js"],
      env: {
        webextensions: true,
      },
      globals: {
        Readability: "readonly",
        fabric: "readonly",
        safari: "readonly",
        browser: "readonly",
      },
      rules: {
        "no-case-declarations": "off",
      },
    },
    {
      // Test files need jest/vitest environment
      files: [
        "tests/**/*.js",
        "tests/**/*.ts",
        "**/*.test.js",
        "**/*.test.ts",
        "**/*.spec.js",
        "**/*.spec.ts",
        "**/tests/**/*.js",
        "**/tests/**/*.ts",
        "**/*.stories.ts",
        "**/*.stories.js",
      ],
      env: {
        jest: true,
        mocha: true,
      },
      globals: {
        vitest: "readonly",
        vi: "readonly",
        before: "readonly",
        after: "readonly",
      },
    },
    {
      // Desktop app files use logger global
      files: [
        "desktop-app-vue/src/main/**/*.js",
        "desktop-app-vue/src/main/**/*.ts",
        "desktop-app-vue/src/renderer/**/*.js",
        "desktop-app-vue/src/renderer/**/*.ts",
      ],
      globals: {
        logger: "readonly",
      },
    },
    {
      // Contracts test files use Hardhat/ethers globals
      files: ["**/contracts/test/**/*.js", "**/contracts/test/**/*.ts"],
      globals: {
        ethers: "readonly",
        network: "readonly",
        artifacts: "readonly",
      },
    },
    {
      // Scripts directory - relaxed rules
      files: ["**/scripts/**/*.js"],
      globals: {
        logger: "readonly",
      },
    },
    {
      // Community forum frontend
      files: ["community-forum/frontend/**/*.js"],
      rules: {
        "react-hooks/rules-of-hooks": "off",
      },
    },
  ],
};
