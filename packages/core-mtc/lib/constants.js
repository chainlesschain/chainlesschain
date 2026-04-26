"use strict";

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

const TREE_HEAD_SIG_PREFIX = Buffer.from("mtc/v1/tree-head\n", "utf-8");
const LANDMARK_SIG_PREFIX = Buffer.from("mtc/v1/landmark\n", "utf-8");

const SCHEMA_ENVELOPE = "mtc-envelope/v1";
const SCHEMA_TREE_HEAD = "mtc-tree-head/v1";
const SCHEMA_LANDMARK = "mtc-landmark/v1";

const NAMESPACE_RE = /^mtc\/v1\/(did|skill|audit)(?:\/[a-zA-Z0-9_-]{1,64})?\/[0-9]{6,}$/;

const HASH_PREFIX = "sha256:";

module.exports = {
  LEAF_PREFIX,
  NODE_PREFIX,
  TREE_HEAD_SIG_PREFIX,
  LANDMARK_SIG_PREFIX,
  SCHEMA_ENVELOPE,
  SCHEMA_TREE_HEAD,
  SCHEMA_LANDMARK,
  NAMESPACE_RE,
  HASH_PREFIX,
};
