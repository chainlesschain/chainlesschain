"use strict";

import { describe, expect, it } from "vitest";

const {
  HuaweiLearningApiClient,
} = require("../../lib/adapters/edu-huawei-learning/api-client");
const {
  ZuoyebangApiClient,
} = require("../../lib/adapters/edu-zuoyebang/api-client");
const {
  NeteaseMusicApiClient,
} = require("../../lib/adapters/netease-music/api-client");

const TERMINAL_PAGE = 10_001;

describe("education and music API pagination defaults", () => {
  it("collects Huawei learning history beyond the former 10,000-page default", async () => {
    const client = new HuaweiLearningApiClient();
    let pages = 0;
    client.getStudyRecordsPage = async () => {
      pages += 1;
      return {
        rows: [{ recordId: `record-${pages}` }],
        hasMore: pages < TERMINAL_PAGE,
        total: null,
      };
    };

    const rows = await client.getAllStudyRecords("cookie", { pageSize: 1 });

    expect(rows).toHaveLength(TERMINAL_PAGE);
    expect(pages).toBe(TERMINAL_PAGE);
  });

  it("collects Zuoyebang history beyond the former 10,000-page default", async () => {
    const client = new ZuoyebangApiClient();
    let pages = 0;
    client.getStudyRecordsPage = async () => {
      pages += 1;
      return {
        rows: [{ recordId: `record-${pages}` }],
        hasMore: pages < TERMINAL_PAGE,
        total: null,
      };
    };

    const rows = await client.getAllStudyRecords("cookie", { pageSize: 1 });

    expect(rows).toHaveLength(TERMINAL_PAGE);
    expect(pages).toBe(TERMINAL_PAGE);
  });

  it("collects NetEase playlists beyond the former 10,000-page default", async () => {
    const client = new NeteaseMusicApiClient();
    let pages = 0;
    client.getUserPlaylistsPage = async () => {
      pages += 1;
      return {
        rows: [{ playlistId: `playlist-${pages}` }],
        more: pages < TERMINAL_PAGE,
      };
    };

    const rows = await client.getAllUserPlaylists("cookie", "uid", {
      pageSize: 1,
    });

    expect(rows).toHaveLength(TERMINAL_PAGE);
    expect(pages).toBe(TERMINAL_PAGE);
  });
});
