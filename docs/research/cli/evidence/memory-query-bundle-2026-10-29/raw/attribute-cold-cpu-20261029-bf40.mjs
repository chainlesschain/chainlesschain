import fs from "node:fs";
import path from "node:path";
const dir = path.resolve(process.argv[2]);
const p = JSON.parse(fs.readFileSync(path.join(dir, "cold-query.cpuprofile")));
const nodes = new Map(p.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
const totals = new Map();
const add = (key, us) => totals.set(key, (totals.get(key) || 0) + us);
for (let i=0;i<p.samples.length;i++) {
  let id=p.samples[i]; const frames=[];
  while (id !== undefined) { frames.push(nodes.get(id).callFrame); id=parent.get(id); }
  const names=frames.map(f => f.functionName);
  const us=p.timeDeltas[i];
  if (names.includes("queryDigest")) add("queryDigest under " + (names.includes("_readQueryIndex") ? "_readQueryIndex" : names.includes("_queryShardSnapshot") ? "_queryShardSnapshot" : "other"), us);
  if (names.includes("update") && frames.some(f => f.url === "node:internal/crypto/hash")) {
    add("hash update under " + (names.includes("queryDigest") ? names.includes("_readQueryIndex") ? "index duplicate hash" : "other queryDigest" : names.includes("canonicalDigest") ? "canonicalDigest" : names.includes("readQueryBundle") || names.includes("readBytes") ? "bundle verification" : "other"),us);
  }
  if (frames.some(f => f.url.endsWith("/canonical.js"))) add("any canonical.js frame on stack",us);
  if (names.includes("compileQueryIndex")) add("compileQueryIndex",us);
}
const receipt = JSON.parse(fs.readFileSync(path.join(dir,"receipt.json")));
const result = {sampleAttributionMs:Object.fromEntries([...totals].map(([key,us])=>[key,us/1000])),fixtureRemoved:!fs.existsSync(receipt.fixtureRoot)};
fs.writeFileSync(path.join(dir,"profile-attribution.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(result,null,2));
