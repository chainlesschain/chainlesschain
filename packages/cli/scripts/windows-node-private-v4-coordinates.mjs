import { isDeepStrictEqual } from "node:util";

const uint32 = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const sid = (value) =>
  typeof value === "string" && /^S-1-\d+(?:-\d+)+$/u.test(value);
const fileObserved = (value) =>
  value?.observed === true &&
  value.error === 0 &&
  typeof value.volumeSerial === "string" &&
  /^[1-9]\d*$/u.test(value.volumeSerial) &&
  typeof value.fileId === "string" &&
  /^[a-f\d]{32}$/u.test(value.fileId) &&
  /[1-9a-f]/u.test(value.fileId) &&
  typeof value.ntPath === "string" &&
  value.ntPath.startsWith("\\Device\\") &&
  !value.ntPath.includes("\0") &&
  typeof value.directory === "boolean" &&
  typeof value.reparse === "boolean" &&
  positive(value.links);

// Validate collected observations, never grant representation or authority
// admission. A real failed native open is retained as a failed observation.
export function inspectPrivateV4RootCoordinates(value, { identity } = {}) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  require(value?.schema ===
    "chainlesschain.private-root-coordinate-observation/v1" &&
    value.readOnly === true &&
    value.scope ===
      "fixed-root-native-open-observations", "coordinate observation profile differs");
  for (const flag of [
    "admissionEligible",
    "compatibilityConfirmed",
    "prefixRebindingExcluded",
    "resolutionContextBound",
    "suffixSemanticsVerified",
    "mappingChanged",
  ])
    require(value?.[flag] === false, `unsupported coordinate claim: ${flag}`);
  const physical = identity?.root?.physical;
  const logical = identity?.root?.logical;
  const rootDos = physical?.path;
  const validDos =
    typeof rootDos === "string" &&
    /^[A-Za-z]:\\[^\\]+(?:\\[^\\]+)*$/u.test(rootDos) &&
    rootDos
      .slice(3)
      .split("\\")
      .every(
        (part) =>
          part !== "." &&
          part !== ".." &&
          [...part].every((char) => char.charCodeAt(0) >= 32) &&
          !/[/:*?"<>|]/u.test(part) &&
          !/[. ]$/u.test(part),
      );
  require(identity?.schema === "chainlesschain.windows-private-identity/v4" &&
    validDos &&
    logical?.path === "X:\\" &&
    physical?.ntPath === logical?.ntPath &&
    physical?.fileId === logical?.fileId &&
    physical?.volumeSerial === logical?.volumeSerial &&
    [physical, logical].every(
      (file) =>
        fileObserved({ ...file, observed: true, error: 0 }) &&
        file.directory === true &&
        file.reparse === false &&
        file.links === 1,
    ) &&
    positive(identity?.actor?.pid) &&
    identity?.token?.capabilityCount === 0 &&
    sid(identity?.token?.appContainerSid), "held root identity differs");
  const expectedRoot = {
    observed: true,
    error: 0,
    volumeSerial: physical?.volumeSerial,
    fileId: physical?.fileId,
    ntPath: physical?.ntPath,
    directory: true,
    reparse: false,
    links: 1,
  };
  require(fileObserved(value?.inheritedRoot) &&
    isDeepStrictEqual(
      value.inheritedRoot,
      expectedRoot,
    ), "inherited root observation differs");
  const roots = Array.isArray(value?.roots) ? value.roots : [];
  require(roots.length === 2, "coordinate population differs");
  let equal = roots.length === 2;
  const names = ["\\??\\Global\\" + rootDos, "\\??\\X:\\"];
  for (let index = 0; index < roots.length; index++) {
    const row = roots[index];
    require(row !== null &&
      typeof row === "object" &&
      index < 2 &&
      row.kind === ["global-dos", "private-x"][index] &&
      row?.nativeName === names[index] &&
      row.desiredAccess === 1048704 &&
      row.shareAccess === 7 &&
      row.openOptions === 2097185 &&
      uint32(row.ntStatus) &&
      uint32(row.ioStatus) &&
      typeof row.ioInformation === "string" &&
      /^\d+$/u.test(row.ioInformation) &&
      typeof row.opened === "boolean" &&
      typeof row.matchesInheritedRoot ===
        "boolean", "native root open evidence differs");
    require(row?.opened === (row?.ntStatus === 0) &&
      (row?.ntStatus === 0 ||
        row?.ntStatus >=
          0x80000000), "native root status and opened result disagree");
    let matches = false;
    if (row?.opened) {
      require(row.ioStatus === 0 &&
        row.ioInformation === "1", "root open completion differs");
      require(fileObserved(row.file), "opened root metadata incomplete");
      matches = isDeepStrictEqual(row.file, expectedRoot);
    } else require(row?.file === null, "failed root open has metadata");
    require(row?.matchesInheritedRoot ===
      matches, "root identity match is false");
    equal = equal && matches;
  }
  require(value?.rootCoordinateObservedEqual ===
    equal, "root equality verdict disagrees with observations");
  const alias = value?.globalAlias;
  require(alias?.nativeName === "\\??\\Global\\" + rootDos?.[0] + ":" &&
    alias?.desiredAccess === 1 &&
    uint32(alias?.openStatus) &&
    typeof alias?.opened === "boolean" &&
    alias.opened === alias.openStatus < 0x80000000 &&
    (alias.openStatus === 0 || alias.openStatus >= 0x80000000) &&
    alias.queryAttempted === alias.opened &&
    uint32(alias.targetBytes) &&
    uint32(alias.targetLengthBytes) &&
    uint32(alias.objectNameLengthBytes) &&
    typeof alias.targetDecodeComplete === "boolean" &&
    typeof alias.objectNameDecodeComplete ===
      "boolean", "Global alias open evidence differs");
  if (alias?.opened)
    require(uint32(alias.queryStatus) &&
      uint32(alias.objectNameStatus) &&
      (alias.objectName === null ||
        (typeof alias.objectName === "string" &&
          alias.objectName.startsWith("\\") &&
          !alias.objectName.includes(
            "\0",
          ))), "Global alias query evidence differs");
  else
    require(alias?.queryStatus === null &&
      alias?.objectNameStatus === null &&
      alias?.objectName === null &&
      alias?.target === null &&
      alias?.targetBytes === 0 &&
      alias?.targetLengthBytes === 0 &&
      alias?.objectNameLengthBytes === 0 &&
      alias?.targetDecodeComplete === false &&
      alias?.objectNameDecodeComplete ===
        false, "unopened Global alias contains query results");
  if (alias?.opened) {
    for (const [statusKey, valueKey, lengthKey, decodedKey] of [
      ["queryStatus", "target", "targetLengthBytes", "targetDecodeComplete"],
      [
        "objectNameStatus",
        "objectName",
        "objectNameLengthBytes",
        "objectNameDecodeComplete",
      ],
    ]) {
      const success = uint32(alias[statusKey]) && alias[statusKey] === 0;
      const text = alias[valueKey];
      require(success
        ? alias[decodedKey] === true &&
            typeof text === "string" &&
            text.startsWith("\\") &&
            !text.includes("\0") &&
            uint32(alias[lengthKey]) &&
            alias[lengthKey] > 0 &&
            alias[lengthKey] === text.length * 2
        : alias[decodedKey] === false &&
            text === null &&
            alias[statusKey] >=
              0x80000000, "Global alias status and decoded value disagree");
    }
    require(alias.targetBytes % 2 ===
      0, "Global alias returned length differs");
  }
  const aliasObserved =
    alias?.opened === true &&
    uint32(alias.queryStatus) &&
    alias.queryStatus === 0 &&
    alias.targetDecodeComplete === true &&
    typeof alias.target === "string" &&
    alias.target.length > 0 &&
    !alias.target.includes("\0");
  require(value?.globalAliasObserved ===
    aliasObserved, "Global alias verdict disagrees with observations");
  const expectedContext = (context) =>
    positive(context?.threadId) &&
    positive(context?.pid) &&
    context.pid === identity?.actor?.pid &&
    context.threadTokenOpened === false &&
    context.threadTokenError === 1008 &&
    context.noImpersonationObserved === true &&
    context.effectiveTokenKnown === true &&
    context.error === 0 &&
    context.tokenType === 1 &&
    context.appContainer === true &&
    sid(context.userSid) &&
    context.appContainerSid === identity?.token?.appContainerSid &&
    context.capabilityCount === 0;
  for (const context of [value?.contextBefore, value?.contextAfter])
    require(expectedContext(context), "LowBox parsing context incomplete");
  const contextObservedStable =
    expectedContext(value?.contextBefore) &&
    expectedContext(value?.contextAfter) &&
    isDeepStrictEqual(value?.contextBefore, value?.contextAfter);
  require(value?.resolutionContextObservedStable ===
    contextObservedStable, "context observation verdict disagrees");
  return {
    observationsVerified: errors.length === 0,
    rootCoordinateObservedEqual: equal,
    globalAliasObserved: aliasObserved,
    resolutionContextObservedStable: contextObservedStable,
    compatibilityConfirmed: false,
    admissionEligible: false,
    errors,
  };
}
