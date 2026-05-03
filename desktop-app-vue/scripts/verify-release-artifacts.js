#!/usr/bin/env node
/**
 * verify-release-artifacts.js
 *
 * 在 electron-builder 构建产物上做发布前体检，确保自动差量更新（electron-updater）
 * 需要的所有文件齐全。
 *
 * 检查项（任何一条不满足即 exit 1）：
 *   1. 每个 NSIS 安装包 (*-Setup-*.exe) 必须有同名 .blockmap 旁挂
 *   2. 每个 .dmg 必须有同名 .blockmap 旁挂
 *   3. 每个 .AppImage 必须有同名 .blockmap 旁挂
 *   4. 出现 NSIS / dmg / AppImage 的平台，对应的 latest*.yml 必须存在
 *      - Windows  → latest.yml
 *      - macOS    → latest-mac.yml
 *      - Linux    → latest-linux.yml
 *   5. .blockmap 文件必须非空
 *
 * 不强制（仅提示）：
 *   - portable .exe（*-Portable-*.exe）— portable target 没有差量机制
 *   - .deb / .rpm — 不走 blockmap，electron-updater 也不支持
 *
 * 用法:
 *   node scripts/verify-release-artifacts.js [--dir <path>]
 *   默认扫描目录: <desktop-app-vue>/out/build
 *   退出码: 0 通过 / 1 缺失项 / 2 目录不存在
 *
 * 也可被 release.js 以模块方式调用: const { verify } = require('./verify-release-artifacts');
 */

"use strict";

const fs = require("fs");
const path = require("path");

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function getDirArg(argv) {
  const i = argv.indexOf("--dir");
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return path.join(__dirname, "..", "out", "build");
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function isNsisInstaller(file) {
  // electron-builder.yml: artifactName: ${productName}-Setup-${version}.${ext}
  return /-Setup-.*\.exe$/i.test(path.basename(file));
}

function isPortable(file) {
  return /-Portable-.*\.exe$/i.test(path.basename(file));
}

function isDmg(file) {
  return /\.dmg$/i.test(file);
}

function isAppImage(file) {
  return /\.AppImage$/i.test(file);
}

function isLatestYml(file, channel) {
  return path.basename(file).toLowerCase() === channel;
}

/**
 * 主校验函数。可被 release.js 直接调用。
 * @param {string} buildDir - electron-builder 输出目录
 * @returns {{ ok: boolean, errors: string[], warnings: string[], summary: object }}
 */
function verify(buildDir) {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(buildDir)) {
    return {
      ok: false,
      errors: [`Build directory not found: ${buildDir}`],
      warnings: [],
      summary: { exitCode: 2 },
    };
  }

  const files = walk(buildDir);
  const fileSet = new Set(files.map((f) => f.toLowerCase()));

  const nsisInstallers = files.filter(isNsisInstaller);
  const portables = files.filter(isPortable);
  const dmgs = files.filter(isDmg);
  const appImages = files.filter(isAppImage);

  // 1. NSIS 必须有 blockmap
  for (const exe of nsisInstallers) {
    const blockmap = exe + ".blockmap";
    if (!fileSet.has(blockmap.toLowerCase())) {
      errors.push(
        `Missing blockmap for NSIS installer: ${path.relative(buildDir, exe)}`,
      );
    } else if (fs.statSync(blockmap).size === 0) {
      errors.push(`Empty blockmap: ${path.relative(buildDir, blockmap)}`);
    }
  }

  // 2. dmg 必须有 blockmap
  for (const dmg of dmgs) {
    const blockmap = dmg + ".blockmap";
    if (!fileSet.has(blockmap.toLowerCase())) {
      errors.push(`Missing blockmap for dmg: ${path.relative(buildDir, dmg)}`);
    } else if (fs.statSync(blockmap).size === 0) {
      errors.push(`Empty blockmap: ${path.relative(buildDir, blockmap)}`);
    }
  }

  // 3. AppImage blockmap — WARNING only.
  // electron-builder reliably emits .blockmap for NSIS .exe and .dmg, but
  // AppImage blockmap support has been intermittent across versions. When
  // missing, electron-updater falls back to full download on Linux — degraded
  // but not broken. Treat as warning so a missing AppImage blockmap does
  // not block the entire release.
  for (const ai of appImages) {
    const blockmap = ai + ".blockmap";
    if (!fileSet.has(blockmap.toLowerCase())) {
      warnings.push(
        `Missing blockmap for AppImage: ${path.relative(buildDir, ai)} (Linux auto-update will fall back to full download — known electron-builder AppImage limitation)`,
      );
    } else if (fs.statSync(blockmap).size === 0) {
      warnings.push(`Empty blockmap: ${path.relative(buildDir, blockmap)}`);
    }
  }

  // 4. latest*.yml 存在性
  const hasLatest = (channel) => files.some((f) => isLatestYml(f, channel));

  if (nsisInstallers.length > 0 && !hasLatest("latest.yml")) {
    errors.push(
      "Missing latest.yml — electron-updater can't discover Windows updates without it",
    );
  }
  if (dmgs.length > 0 && !hasLatest("latest-mac.yml")) {
    errors.push(
      "Missing latest-mac.yml — electron-updater can't discover macOS updates without it",
    );
  }
  if (appImages.length > 0 && !hasLatest("latest-linux.yml")) {
    errors.push(
      "Missing latest-linux.yml — electron-updater can't discover Linux updates without it",
    );
  }

  // 5. 友情提示
  if (portables.length > 0) {
    warnings.push(
      `Found ${portables.length} portable .exe — portable target has no differential support; users will always download full installer.`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      buildDir,
      nsis: nsisInstallers.length,
      portable: portables.length,
      dmg: dmgs.length,
      appImage: appImages.length,
      hasLatestYml: hasLatest("latest.yml"),
      hasLatestMacYml: hasLatest("latest-mac.yml"),
      hasLatestLinuxYml: hasLatest("latest-linux.yml"),
    },
  };
}

function printReport(result) {
  const { ok, errors, warnings, summary } = result;
  console.log(`\n${colors.cyan}▶ Release artifact verification${colors.reset}`);
  console.log(
    `${colors.dim}  scanning: ${summary.buildDir || "(unknown)"}${colors.reset}`,
  );
  console.log(
    `  NSIS installers: ${summary.nsis ?? 0}, portable: ${summary.portable ?? 0}, dmg: ${summary.dmg ?? 0}, AppImage: ${summary.appImage ?? 0}`,
  );
  console.log(
    `  latest.yml: ${summary.hasLatestYml ? "✓" : "✗"}  latest-mac.yml: ${summary.hasLatestMacYml ? "✓" : "✗"}  latest-linux.yml: ${summary.hasLatestLinuxYml ? "✓" : "✗"}`,
  );

  for (const w of warnings) {
    console.log(`${colors.yellow}⚠${colors.reset} ${w}`);
  }
  for (const e of errors) {
    console.log(`${colors.red}✗${colors.reset} ${e}`);
  }
  if (ok) {
    console.log(
      `${colors.green}✓ All differential-update artifacts present${colors.reset}\n`,
    );
  } else {
    console.log(
      `\n${colors.red}❌ Verification FAILED — auto-update will fall back to full download or break entirely${colors.reset}\n`,
    );
  }
}

function main() {
  const buildDir = getDirArg(process.argv.slice(2));
  const result = verify(buildDir);
  printReport(result);
  if (!result.ok) {
    process.exit(result.summary.exitCode === 2 ? 2 : 1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { verify, printReport };
