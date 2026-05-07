/**
 * archive-provider-factory — turns a renderer-supplied {kind, ...opts}
 * spec into a provider instance for ChannelEnvelopeArchiver. Extracted
 * from social-initializer.js so it can be unit-tested independently.
 *
 * Two modes for `kind: 'webdav'`:
 *   - `useStoredCredentials: true` — main resolves credentials from
 *     sync-credentials secure store (no key material on the wire from
 *     renderer). Reuses the Phase 3c sync-credentials vault — single
 *     source of WebDAV creds for both sync and archive.
 *   - explicit-spec — caller passes `{url, username, password,
 *     remotePath}` inline (CLI / tests / advanced-user path).
 *
 * @module mtc/archive-provider-factory
 */

const {
  filesystemProvider,
  webdavProvider,
} = require("./channel-envelope-archiver");

/**
 * Build a factory bound to the given dependency module references.
 * Tests inject mock `syncCredentials` / `WebDAVClient`; production
 * resolves them via require() at module load.
 *
 * @param {object} [deps]
 * @param {object} [deps.syncCredentials] - module with hasCredentials() / getCredentials()
 * @param {Function} [deps.WebDAVClient] - WebDAVClient constructor
 * @returns {Function} factory(spec) → provider
 */
function createArchiveProviderFactory(deps = {}) {
  const syncCredentials =
    deps.syncCredentials || require("../sync/sync-credentials");
  const WebDAVClient =
    deps.WebDAVClient || require("../sync/webdav-client").WebDAVClient;

  return function archiveProviderFactoryImpl(spec) {
    if (!spec || typeof spec !== "object") {
      throw new Error("provider spec required");
    }

    if (spec.kind === "filesystem") {
      if (!spec.rootDir) {
        throw new Error("filesystem provider needs rootDir");
      }
      return filesystemProvider({ rootDir: spec.rootDir });
    }

    if (spec.kind === "webdav") {
      let url, username, password, remotePath;
      if (spec.useStoredCredentials) {
        if (!syncCredentials.hasCredentials("webdav")) {
          throw new Error(
            "useStoredCredentials=true but no WebDAV credentials saved yet (configure in Settings → 同步 → WebDAV first)",
          );
        }
        const stored = syncCredentials.getCredentials("webdav");
        url = stored.url;
        username = stored.username;
        password = stored.password;
        remotePath = stored.remotePath || "/";
      } else {
        url = spec.url;
        username = spec.username;
        password = spec.password;
        remotePath = spec.remotePath;
      }
      if (!url) {
        throw new Error(
          "webdav provider needs url (either via useStoredCredentials or explicit spec)",
        );
      }
      const client = new WebDAVClient({ url, username, password, remotePath });
      return webdavProvider(client);
    }

    throw new Error("unsupported provider kind: " + (spec.kind || "<empty>"));
  };
}

module.exports = { createArchiveProviderFactory };
