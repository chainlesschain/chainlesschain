import fs from "node:fs";
import path from "node:path";
const directory = path.resolve(process.argv[2]);
const profile = JSON.parse(fs.readFileSync(path.join(directory, "cold-query.cpuprofile"), "utf8"));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parents = new Map();
for (const node of nodes.values()) for (const child of node.children || []) parents.set(child, node.id);
const key = (node) => `${node.callFrame.functionName || "(anonymous)"} ${node.callFrame.url || "(native)"}:${node.callFrame.lineNumber + 1}`;
const self = new Map(), inclusive = new Map(), files = new Map();
const add = (map, name, us) => map.set(name, (map.get(name) || 0) + us);
let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const us = profile.timeDeltas[i];
  total += us;
  const node = nodes.get(profile.samples[i]);
  add(self, key(node), us);
  add(files, node.callFrame.url || node.callFrame.functionName || "native", us);
  const seen = new Set();
  let id = node.id;
  while (id !== undefined) {
    const name = key(nodes.get(id));
    if (!seen.has(name)) { add(inclusive, name, us); seen.add(name); }
    id = parents.get(id);
  }
}
const ordered = (map) => [...map].sort((a,b) => b[1]-a[1]).map(([name, us]) => ({ name, ms: us/1000, percent: us/total*100 }));
const report = {
  samples: profile.samples.length,
  sampledMs: total/1000,
  profileElapsedMs: (profile.endTime-profile.startTime)/1000,
  note: "Self samples partition sampled time; inclusive functions overlap. Recursive identical function frames are counted only once per sample.",
  topSelf: ordered(self).slice(0,40),
  topInclusive: ordered(inclusive).slice(0,60),
  sourceSelf: ordered(files),
  shaAndCanonicalInclusive: ordered(inclusive).filter((entry) => /canonical|queryDigest|compileQueryIndex|normalizeState|normalizeMemoryRecord|_decodeShard|Hash|readQueryBundle|clone/.test(entry.name)),
};
fs.writeFileSync(path.join(directory, "profile-analysis.json"), JSON.stringify(report, null, 2)+"\n", {flag:"wx"});
console.log(JSON.stringify(report, null, 2));
