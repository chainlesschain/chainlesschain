const asar = require("@electron/asar");
const path = require("path");

const asarPath = process.argv[2] || "out/build/win-unpacked/resources/app.asar";
const absPath = path.resolve(asarPath);

const raw = asar.getRawHeader(absPath);
const header = raw.header;

console.log("Top-level node_modules entries in asar header:");
const nm = header.files.node_modules;
if (!nm || !nm.files) {
  console.log("  NO top-level node_modules in header!");
} else {
  const names = Object.keys(nm.files).sort();
  console.log("  Total top-level pkgs:", names.length);
  for (const target of [
    "call-bind-apply-helpers",
    "side-channel-list",
    "side-channel-map",
    "side-channel-weakmap",
  ]) {
    const present = names.includes(target);
    console.log(`  ${target}: ${present ? "PRESENT" : "MISSING"}`);
    if (present) {
      const sub = nm.files[target];
      console.log(
        `    has package.json: ${!!(sub.files && sub.files["package.json"])}`,
      );
    }
  }
}

console.log("---");
console.log("Are nested copies under call-bind / side-channel still present?");
for (const parent of ["call-bind", "side-channel"]) {
  const p = nm?.files?.[parent]?.files?.node_modules?.files;
  if (p) {
    console.log(`  ${parent}/node_modules/: [${Object.keys(p).join(", ")}]`);
  } else {
    console.log(`  ${parent}/node_modules/: not present`);
  }
}
