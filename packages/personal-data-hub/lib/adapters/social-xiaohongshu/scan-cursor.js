"use strict";

const {
  createBoundedCollectionCursor,
} = require("../_bounded-collection-cursor");

module.exports = createBoundedCollectionCursor({
  namespace: "social-xiaohongshu",
  codePrefix: "XIAOHONGSHU",
});
