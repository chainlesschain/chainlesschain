import assert from "node:assert/strict";
import test from "node:test";
import { inspectPrivateV4RootCoordinates } from "../scripts/windows-node-private-v4-coordinates.mjs";

function fixture() {
  const file = {
    observed: true,
    error: 0,
    volumeSerial: "17",
    fileId: "0123456789abcdef0123456789abcdef",
    ntPath: "\\Device\\HarddiskVolume3\\capsule",
    directory: true,
    reparse: false,
    links: 1,
  };
  const context = {
    threadId: 12,
    pid: 11,
    threadTokenOpened: false,
    threadTokenError: 1008,
    noImpersonationObserved: true,
    effectiveTokenKnown: true,
    error: 0,
    tokenType: 1,
    appContainer: true,
    userSid: "S-1-5-21-1-2-3-1001",
    appContainerSid: "S-1-15-2-1-2-3-4-5-6-7",
    capabilityCount: 0,
  };
  const identity = {
    schema: "chainlesschain.windows-private-identity/v4",
    actor: { pid: 11 },
    token: { appContainerSid: context.appContainerSid, capabilityCount: 0 },
    root: {
      physical: { ...file, path: "C:\\capsule" },
      logical: { ...file, path: "X:\\" },
    },
  };
  const value = {
    schema: "chainlesschain.private-root-coordinate-observation/v1",
    readOnly: true,
    scope: "fixed-root-native-open-observations",
    admissionEligible: false,
    compatibilityConfirmed: false,
    prefixRebindingExcluded: false,
    resolutionContextBound: false,
    suffixSemanticsVerified: false,
    mappingChanged: false,
    inheritedRoot: structuredClone(file),
    roots: ["global-dos", "private-x"].map((kind, index) => ({
      kind,
      nativeName: index ? "\\??\\X:\\" : "\\??\\Global\\C:\\capsule",
      desiredAccess: 1048704,
      shareAccess: 7,
      openOptions: 2097185,
      ntStatus: 0,
      ioStatus: 0,
      ioInformation: "1",
      opened: true,
      matchesInheritedRoot: true,
      file: structuredClone(file),
    })),
    globalAlias: {
      nativeName: "\\??\\Global\\C:",
      desiredAccess: 1,
      openStatus: 0,
      opened: true,
      queryAttempted: true,
      queryStatus: 0,
      objectNameStatus: 0,
      objectName: "\\GLOBAL??\\C:",
      targetBytes: 46,
      targetLengthBytes: 46,
      targetDecodeComplete: true,
      objectNameLengthBytes: 24,
      objectNameDecodeComplete: true,
      target: "\\Device\\HarddiskVolume3",
    },
    rootCoordinateObservedEqual: true,
    globalAliasObserved: true,
    resolutionContextObservedStable: true,
    contextBefore: structuredClone(context),
    contextAfter: structuredClone(context),
  };
  return { value, identity };
}
const inspect = ({ value, identity }) =>
  inspectPrivateV4RootCoordinates(value, { identity });
test("matching root observations do not grant compatibility or admission", () => {
  const result = inspect(fixture());
  assert.equal(result.observationsVerified, true);
  assert.equal(result.rootCoordinateObservedEqual, true);
  assert.equal(result.compatibilityConfirmed, false);
  assert.equal(result.admissionEligible, false);
});
test("retains an actual native failure without inventing a root identity", () => {
  const v = fixture();
  Object.assign(v.value.roots[0], {
    ntStatus: 0xc0000022,
    opened: false,
    matchesInheritedRoot: false,
    file: null,
  });
  v.value.rootCoordinateObservedEqual = false;
  assert.equal(inspect(v).observationsVerified, true);
  assert.equal(inspect(v).rootCoordinateObservedEqual, false);
});
test("retains a denied Global alias with no fabricated query", () => {
  const v = fixture();
  Object.assign(v.value.globalAlias, {
    openStatus: 0xc0000022,
    opened: false,
    queryAttempted: false,
    queryStatus: null,
    objectNameStatus: null,
    objectName: null,
    target: null,
    targetBytes: 0,
    targetLengthBytes: 0,
    targetDecodeComplete: false,
    objectNameLengthBytes: 0,
    objectNameDecodeComplete: false,
  });
  v.value.globalAliasObserved = false;
  assert.equal(inspect(v).observationsVerified, true);
});
const cases = [
  ["pending root completion", (v) => (v.value.roots[0].ntStatus = 0x103)],
  [
    "failed root IO completion",
    (v) => (v.value.roots[0].ioStatus = 0xc0000022),
  ],
  ["created root result", (v) => (v.value.roots[0].ioInformation = "2")],
  [
    "held physical root not directory",
    (v) => (v.identity.root.physical.directory = false),
  ],
  [
    "held logical root is reparse",
    (v) => (v.identity.root.logical.reparse = true),
  ],
  ["alias pending open", (v) => (v.value.globalAlias.openStatus = 0x103)],
  [
    "failed alias query fabricated target",
    (v) => (v.value.globalAlias.queryStatus = 0xc0000022),
  ],
  [
    "failed object name fabricated name",
    (v) => (v.value.globalAlias.objectNameStatus = 0xc0000022),
  ],
  [
    "missing successful alias target",
    (v) => {
      v.value.globalAlias.target = null;
      v.value.globalAliasObserved = false;
    },
  ],
  [
    "missing successful object name",
    (v) => (v.value.globalAlias.objectName = null),
  ],
  [
    "odd alias returned byte length",
    (v) => (v.value.globalAlias.targetBytes = 1),
  ],
  [
    "alias decoded byte length differs",
    (v) => (v.value.globalAlias.targetLengthBytes = 2),
  ],
  [
    "object name decoded byte length differs",
    (v) => (v.value.globalAlias.objectNameLengthBytes = 2),
  ],
  [
    "alias decode incomplete",
    (v) => (v.value.globalAlias.targetDecodeComplete = false),
  ],
  [
    "object name decode incomplete",
    (v) => (v.value.globalAlias.objectNameDecodeComplete = false),
  ],
  ["signed status", (v) => (v.value.roots[0].ntStatus = -1073741790)],
  ["false equal root", (v) => (v.value.roots[0].file.fileId = "1".repeat(32))],
  ["different volume", (v) => (v.value.roots[0].file.volumeSerial = "18")],
  ["different NT path", (v) => (v.value.roots[0].file.ntPath += "-other")],
  ["reparse root", (v) => (v.value.roots[0].file.reparse = true)],
  ["missing root", (v) => v.value.roots.pop()],
  ["duplicate root", (v) => v.value.roots.push(v.value.roots[0])],
  [
    "namespace substitution",
    (v) => (v.value.roots[0].nativeName = "C:\\capsule"),
  ],
  ["extra native access", (v) => (v.value.roots[0].desiredAccess = 0x10000000)],
  ["false open", (v) => (v.value.roots[0].ntStatus = 0xc0000022)],
  ["missing metadata", (v) => (v.value.roots[0].file = null)],
  ["false matches", (v) => (v.value.roots[0].matchesInheritedRoot = false)],
  ["false root verdict", (v) => (v.value.rootCoordinateObservedEqual = false)],
  ["false alias verdict", (v) => (v.value.globalAliasObserved = false)],
  [
    "alias path substituted",
    (v) => (v.value.globalAlias.nativeName = "\\??\\C:"),
  ],
  ["alias contains NUL", (v) => (v.value.globalAlias.target += "\0tail")],
  ["context different thread", (v) => (v.value.contextAfter.threadId += 1)],
  [
    "context wrong process",
    (v) => {
      v.value.contextBefore.pid = 99;
      v.value.contextAfter.pid = 99;
    },
  ],
  ["context different user", (v) => (v.value.contextAfter.userSid += "-1")],
  [
    "context different SID",
    (v) => (v.value.contextBefore.appContainerSid += "-1"),
  ],
  ["impersonation", (v) => (v.value.contextBefore.threadTokenOpened = true)],
  ["unknown token", (v) => (v.value.contextBefore.effectiveTokenKnown = false)],
  ["nonzero capabilities", (v) => (v.value.contextBefore.capabilityCount = 1)],
  [
    "unsafe root path",
    (v) => (v.identity.root.physical.path = "C:\\capsule\\..\\other"),
  ],
  [
    "different inherited file",
    (v) => (v.value.inheritedRoot.fileId = "f".repeat(32)),
  ],
];
for (const flag of [
  "admissionEligible",
  "compatibilityConfirmed",
  "prefixRebindingExcluded",
  "resolutionContextBound",
  "suffixSemanticsVerified",
  "mappingChanged",
])
  cases.push([`unsupported ${flag}`, (v) => (v.value[flag] = true)]);
for (const [name, mutate] of cases)
  test(`rejects ${name}`, () => {
    const v = fixture();
    mutate(v);
    assert.equal(inspect(v).observationsVerified, false);
  });
test("malformed observations return errors instead of throwing", () => {
  for (const value of [
    null,
    {},
    { roots: [null] },
    { roots: [null, null, null] },
  ])
    assert.equal(
      inspectPrivateV4RootCoordinates(value).observationsVerified,
      false,
    );
});
