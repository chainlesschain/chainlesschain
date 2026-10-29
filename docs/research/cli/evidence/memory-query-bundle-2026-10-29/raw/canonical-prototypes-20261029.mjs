import { createHash } from "node:crypto";

// Experiments only. Public canonicalize retains the exact oracle behavior.
export function createPrototypes(oracle, invalidArgument) {
  function check(value, path) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return "primitive";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw invalidArgument("canonical JSON cannot contain non-finite numbers", { path });
      return "primitive";
    }
    if (Array.isArray(value)) return "array";
    if (!value || typeof value !== "object") throw invalidArgument("canonical JSON accepts only plain JSON values", { path });
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalidArgument("canonical JSON objects must be plain objects", { path });
    return "object";
  }
  function keysOf(value) {
    return Object.keys(value).filter(key => value[key] !== undefined).sort((a,b) => a.localeCompare(b,"en"));
  }
  function direct(value, path = "$") {
    const type = check(value,path);
    if (type === "primitive") return JSON.stringify(value);
    if (type === "array") {
      let output = "[";
      for (let i=0;i<value.length;i++) {
        if (i) output += ",";
        output += i in value ? direct(value[i],`${path}[${i}]`) : "null";
      }
      return output + "]";
    }
    let keys = keysOf(value);
    // Object.fromEntries + JSON.stringify sorts real array-index keys numerically.
    // The maximum uint32 value is excluded by the ECMAScript array-index definition.
    const numeric = [], other = [];
    for (const key of keys) {
      if (key !== "4294967295" && String(key >>> 0) === key) numeric.push(key);
      else other.push(key);
    }
    if (numeric.length) keys = numeric.sort((a,b) => Number(a)-Number(b)).concat(other);
    let output = "{";
    for (let i=0;i<keys.length;i++) {
      const key=keys[i];
      if (i) output += ",";
      output += JSON.stringify(key) + ":" + direct(value[key],`${path}.${key}`);
    }
    return output + "}";
  }
  function tree(value, path = "$") {
    const type = check(value,path);
    if (type === "primitive") return Object.is(value,-0) ? 0 : value;
    if (type === "array") {
      const output = new Array(value.length);
      for (let i=0;i<value.length;i++) if (i in value) output[i] = tree(value[i],`${path}[${i}]`);
      return output;
    }
    const output=Object.create(null);
    for (const key of keysOf(value)) output[key]=tree(value[key],`${path}.${key}`);
    return output;
  }
  function api(canonicalJson) {
    return {
      canonicalize: oracle.canonicalize,
      canonicalJson,
      canonicalDigest(value,domain="chainlesschain.context-memory/v1") {
        return `sha256:${createHash("sha256").update(`${domain}\0${canonicalJson(value)}`,"utf8").digest("hex")}`;
      },
      cloneCanonical(value) { return value === undefined ? undefined : JSON.parse(canonicalJson(value)); },
    };
  }
  return { direct:api(direct), tree:api(value => JSON.stringify(tree(value))) };
}
