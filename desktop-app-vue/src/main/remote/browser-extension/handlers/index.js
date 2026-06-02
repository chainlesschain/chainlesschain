import { bookmarksHandlers } from "./bookmarks.js";
import { clipboardHandlers } from "./clipboard.js";
import { historyHandlers } from "./history.js";
import { listTabs, tabsHandlers } from "./tabs.js";

export const commandHandlerRegistry = {
  ...tabsHandlers,
  ...bookmarksHandlers,
  ...historyHandlers,
  ...clipboardHandlers,
};

export { listTabs };
