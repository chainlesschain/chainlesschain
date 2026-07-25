"use strict";

const {
  createBoundedCollectionCursor,
} = require("../_bounded-collection-cursor");

module.exports = createBoundedCollectionCursor({
  namespace: "travel-tencent-map",
  codePrefix: "TENCENT_MAP",
});
