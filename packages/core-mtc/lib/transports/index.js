"use strict";

const types = require("./types.js");
const inMemory = require("./in-memory.js");
const filesystem = require("./filesystem.js");

module.exports = {
  // helpers
  validateNamespacePrefix: types.validateNamespacePrefix,
  namespaceToPrefix: types.namespaceToPrefix,
  announcementFromLandmark: types.announcementFromLandmark,
  prefixMatches: types.prefixMatches,
  SUBSCRIPTION_PREFIX_RE: types.SUBSCRIPTION_PREFIX_RE,

  // backends
  InMemoryBroker: inMemory.InMemoryBroker,
  InMemoryTransport: inMemory.InMemoryTransport,
  FilesystemTransport: filesystem.FilesystemTransport,
};
