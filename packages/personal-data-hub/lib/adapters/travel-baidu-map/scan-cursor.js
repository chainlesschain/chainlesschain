"use strict";

const {
  createBoundedCollectionCursor,
} = require("../_bounded-collection-cursor");

module.exports = createBoundedCollectionCursor({
  namespace: "travel-baidu-map",
  codePrefix: "BAIDU_MAP",
});
