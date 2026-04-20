/**
 * shell-preview/widgets — registry unit tests
 *
 * Covers:
 *  - PREVIEW_WIDGETS exposes exactly the 4 canonical entry ids
 *  - Each entry has a component + non-empty title
 *  - getPreviewWidget() returns undefined for unknown ids
 *  - Registry ids match the DecentralEntries handler contract
 */

import { describe, it, expect } from "vitest";
import {
  PREVIEW_WIDGETS,
  getPreviewWidget,
  type DecentralEntryId,
} from "../index";

describe("shell-preview/widgets registry", () => {
  const EXPECTED_IDS: DecentralEntryId[] = ["p2p", "trade", "social", "ukey"];

  it("exposes the 4 canonical decentralized entry ids", () => {
    expect(Object.keys(PREVIEW_WIDGETS).sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
  });

  it("each widget entry has matching id, non-empty title, and component", () => {
    for (const id of EXPECTED_IDS) {
      const entry = PREVIEW_WIDGETS[id];
      expect(entry.id).toBe(id);
      expect(entry.title).toBeTruthy();
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.component).toBeDefined();
    }
  });

  it("getPreviewWidget() returns the correct entry for known ids", () => {
    for (const id of EXPECTED_IDS) {
      const entry = getPreviewWidget(id);
      expect(entry).toBeDefined();
      expect(entry?.id).toBe(id);
    }
  });

  it("getPreviewWidget() returns undefined for unknown ids", () => {
    expect(getPreviewWidget("unknown")).toBeUndefined();
    expect(getPreviewWidget("")).toBeUndefined();
    expect(getPreviewWidget("P2P")).toBeUndefined(); // case-sensitive
  });

  it("titles are distinct so the drawer header is unambiguous", () => {
    const titles = EXPECTED_IDS.map((id) => PREVIEW_WIDGETS[id].title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
