import { DatabaseSync } from "node:sqlite";
import process from "node:process";
import YjsCollabManager from "../../yjs-collab-manager.js";

const databasePath = process.argv[2];
if (!databasePath) {
  throw new Error("database path is required");
}

const sqlite = new DatabaseSync(databasePath);
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_yjs_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id TEXT NOT NULL,
    update_data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const manager = new YjsCollabManager(null, {
  getDatabase: () => sqlite,
});
manager.getDocument("crash-doc").getMap("state").set("beforeCrash", "durable");

// The parent terminates this process externally after observing that the
// synchronous SQLite commit completed. Do not close the manager or database.
process.stdout.write("YJS_CRASH_WRITER_READY\n");
setInterval(() => {}, 1000);
