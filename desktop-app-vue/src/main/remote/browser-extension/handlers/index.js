import { bookmarksHandlers } from "./bookmarks.js";
import { cacheHandlers } from "./cache.js";
import { clipboardHandlers } from "./clipboard.js";
import { devtoolsDebugHandlers } from "./devtools-debug.js";
import { devtoolsInspectHandlers } from "./devtools-inspect.js";
import { domHandlers } from "./dom.js";
import { downloadsHandlers } from "./downloads.js";
import { historyHandlers } from "./history.js";
import { inputHandlers } from "./input.js";
import { indexeddbHandlers } from "./indexeddb.js";
import { networkHandlers } from "./network.js";
import { notificationsHandlers } from "./notifications.js";
import { pageHandlers } from "./page.js";
import { selectionDragdropHandlers } from "./selection-dragdrop.js";
import { storageHandlers } from "./storage.js";
import { listTabs, tabsHandlers } from "./tabs.js";
import { windowsHandlers } from "./windows.js";

export const commandHandlerRegistry = {
  ...tabsHandlers,
  ...bookmarksHandlers,
  ...historyHandlers,
  ...clipboardHandlers,
  ...notificationsHandlers,
  ...downloadsHandlers,
  ...windowsHandlers,
  ...storageHandlers,
  ...indexeddbHandlers,
  ...cacheHandlers,
  ...networkHandlers,
  ...devtoolsDebugHandlers,
  ...devtoolsInspectHandlers,
  ...pageHandlers,
  ...domHandlers,
  ...selectionDragdropHandlers,
  ...inputHandlers,
};

export { listTabs };
