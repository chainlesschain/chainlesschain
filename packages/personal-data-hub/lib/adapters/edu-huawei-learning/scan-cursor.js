"use strict";

const {
  createBoundedCollectionCursor,
} = require("../_bounded-collection-cursor");

module.exports = createBoundedCollectionCursor({
  namespace: "edu-huawei-learning",
  codePrefix: "HUAWEI_LEARNING",
});
