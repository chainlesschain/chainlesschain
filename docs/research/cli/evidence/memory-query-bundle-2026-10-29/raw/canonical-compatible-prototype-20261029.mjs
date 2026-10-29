import { createHash } from "node:crypto";

export function createCompatiblePrototype(oracle, invalidArgument) {
  function canonicalTree(value, path = "$") {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw invalidArgument("canonical JSON cannot contain non-finite numbers", { path });
      return Object.is(value, -0) ? 0 : value;
    }
    // Preserve map's holes, inherited indices, length snapshot, overrides and species.
    if (Array.isArray(value)) return value.map((entry,index) => canonicalTree(entry,`${path}[${index}]`));
    if (!value || typeof value !== "object") throw invalidArgument("canonical JSON accepts only plain JSON values", { path });
    const prototype=Object.getPrototypeOf(value);
    if (prototype!==Object.prototype && prototype!==null) throw invalidArgument("canonical JSON objects must be plain objects", { path });
    const keys=Object.keys(value).filter(key=>value[key]!==undefined).sort((a,b)=>a.localeCompare(b,"en"));
    const output=Object.create(null);
    for(const key of keys) output[key]=canonicalTree(value[key],`${path}.${key}`);
    // Match Object.fromEntries' ordinary-object result, including inherited toJSON.
    // Assignment occurred with no prototype, so __proto__ and inherited setters are safe.
    return Object.setPrototypeOf(output,Object.prototype);
  }
  const canonicalJson=value=>JSON.stringify(canonicalTree(value));
  return {
    canonicalize:oracle.canonicalize,
    canonicalJson,
    canonicalDigest(value,domain="chainlesschain.context-memory/v1") {return `sha256:${createHash("sha256").update(`${domain}\0${canonicalJson(value)}`,"utf8").digest("hex")}`;},
    cloneCanonical(value) {return value===undefined?undefined:JSON.parse(canonicalJson(value));},
  };
}
