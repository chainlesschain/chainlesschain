export const TRUSTED_NATIVE_RELEASE_REPOSITORY =
  "chainlesschain/chainlesschain";

export const WINGET_PACKAGE_IDENTIFIER = "ChainlessChain.ChainlessChainCLI";
export const WINGET_MANIFEST_VERSION = "1.9.0";
export const WINGET_MANIFEST_FILES = Object.freeze({
  version: `${WINGET_PACKAGE_IDENTIFIER}.yaml`,
  defaultLocale: `${WINGET_PACKAGE_IDENTIFIER}.locale.en-US.yaml`,
  installer: `${WINGET_PACKAGE_IDENTIFIER}.installer.yaml`,
});

export const NATIVE_PACKAGE_MANAGER_CONTRACT = Object.freeze({
  schema: 2,
  generator: "chainlesschain.package-manager-manifests.v2",
  homebrewFormula: "chainlesschain.rb",
  wingetPackageIdentifier: WINGET_PACKAGE_IDENTIFIER,
  wingetManifestVersion: WINGET_MANIFEST_VERSION,
  wingetFiles: Object.freeze([
    WINGET_MANIFEST_FILES.version,
    WINGET_MANIFEST_FILES.defaultLocale,
    WINGET_MANIFEST_FILES.installer,
  ]),
});

// SemVer 2.0.0, including the no-leading-zero rule for numeric identifiers.
const STRICT_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

function assertExact(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${expected}, received ${actual ?? "missing"}`,
    );
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

export function assertStrictSemver(value, label = "version") {
  if (typeof value !== "string" || !STRICT_SEMVER_PATTERN.test(value)) {
    throw new Error(`${label} must be a strict SemVer 2.0.0 version`);
  }
  return value;
}

export function assertNativeReleaseIdentity(tag, version) {
  assertStrictSemver(version, "native CLI version");
  assertExact(tag, `cli-v${version}`, "native release tag");
  return { tag, version };
}

export function nativePackageManagerContract() {
  return {
    schema: NATIVE_PACKAGE_MANAGER_CONTRACT.schema,
    generator: NATIVE_PACKAGE_MANAGER_CONTRACT.generator,
    homebrew: {
      formula: NATIVE_PACKAGE_MANAGER_CONTRACT.homebrewFormula,
    },
    winget: {
      packageIdentifier:
        NATIVE_PACKAGE_MANAGER_CONTRACT.wingetPackageIdentifier,
      manifestVersion: NATIVE_PACKAGE_MANAGER_CONTRACT.wingetManifestVersion,
      files: [...NATIVE_PACKAGE_MANAGER_CONTRACT.wingetFiles],
    },
  };
}

export function assertNativePackageManagerContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("signed package-manager contract must be an object");
  }
  assertExact(
    value.schema,
    NATIVE_PACKAGE_MANAGER_CONTRACT.schema,
    "package-manager contract schema",
  );
  assertExact(
    value.generator,
    NATIVE_PACKAGE_MANAGER_CONTRACT.generator,
    "package-manager generator",
  );
  assertExact(
    value.homebrew?.formula,
    NATIVE_PACKAGE_MANAGER_CONTRACT.homebrewFormula,
    "Homebrew formula contract",
  );
  assertExact(
    value.winget?.packageIdentifier,
    NATIVE_PACKAGE_MANAGER_CONTRACT.wingetPackageIdentifier,
    "WinGet package identifier contract",
  );
  assertExact(
    value.winget?.manifestVersion,
    NATIVE_PACKAGE_MANAGER_CONTRACT.wingetManifestVersion,
    "WinGet manifest version contract",
  );
  const files = value.winget?.files;
  if (
    !Array.isArray(files) ||
    files.length !== NATIVE_PACKAGE_MANAGER_CONTRACT.wingetFiles.length ||
    files.some(
      (file, index) =>
        file !== NATIVE_PACKAGE_MANAGER_CONTRACT.wingetFiles[index],
    )
  ) {
    throw new Error("signed WinGet file-set contract is invalid");
  }
  if (
    JSON.stringify(canonicalValue(value)) !==
    JSON.stringify(canonicalValue(nativePackageManagerContract()))
  ) {
    throw new Error(
      "signed package-manager contract contains unsupported fields",
    );
  }
  return value;
}
