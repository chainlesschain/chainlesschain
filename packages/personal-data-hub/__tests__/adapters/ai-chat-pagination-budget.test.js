"use strict";

import { describe, expect, it } from "vitest";

const { CookieAuthSession } = require("../../lib/adapters/ai-chat-history");
const deepseekModule = require("../../lib/adapters/ai-chat-history/vendors/deepseek");
const kimiModule = require("../../lib/adapters/ai-chat-history/vendors/kimi");
const {
  DEFAULT_MAX_PAGES,
  resolveMaxPages,
} = require("../../lib/adapters/ai-chat-history/vendors/pagination");

const LEGACY_DEFAULT_MAX_PAGES = 200;
const COMPLETE_PAGE_COUNT = LEGACY_DEFAULT_MAX_PAGES + 1;

async function collect(iterable) {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
}

function makeSession(vendor) {
  return new CookieAuthSession({ vendor, cookies: [] });
}

describe("AI chat default pagination budget", () => {
  it("keeps the shared default unbounded while preserving explicit caps", () => {
    expect(DEFAULT_MAX_PAGES).toBe(Number.POSITIVE_INFINITY);
    expect(resolveMaxPages({})).toBe(Number.POSITIVE_INFINITY);
    expect(resolveMaxPages({ maxPages: 7 })).toBe(7);
  });

  it("collects DeepSeek conversations beyond the former 200-page cap", async () => {
    const calls = [];
    const httpClient = {
      async getJson(url) {
        const pageIndex = calls.length;
        calls.push(url);
        const timestamp = 1_700_000_000 - pageIndex;
        return {
          code: 0,
          data: {
            biz_data: {
              chat_sessions: [
                {
                  id: `deepseek-${pageIndex}`,
                  inserted_at: timestamp,
                  updated_at: timestamp,
                },
              ],
              has_more: pageIndex + 1 < COMPLETE_PAGE_COUNT,
            },
          },
        };
      },
    };

    const conversations = await collect(
      deepseekModule.SPEC.listConversations(
        {
          httpClient,
          session: makeSession("deepseek"),
          vendor: "deepseek",
        },
        { pageSize: 1 },
      ),
    );

    expect(conversations).toHaveLength(COMPLETE_PAGE_COUNT);
    expect(calls).toHaveLength(COMPLETE_PAGE_COUNT);
    expect(conversations.at(-1).originalId).toBe(
      `deepseek-${LEGACY_DEFAULT_MAX_PAGES}`,
    );
  });

  it("collects Kimi conversations beyond the former 200-page cap", async () => {
    const calls = [];
    const httpClient = {
      async getJson(url) {
        calls.push(url);
        const offset = Number(new URL(url).searchParams.get("offset"));
        return {
          code: 0,
          items: [
            {
              id: `kimi-${offset}`,
              created_at: 1_700_000_000 - offset,
              updated_at: 1_700_000_000 - offset,
            },
          ],
          total: COMPLETE_PAGE_COUNT,
          has_more: offset + 1 < COMPLETE_PAGE_COUNT,
        };
      },
    };

    const conversations = await collect(
      kimiModule.SPEC.listConversations(
        {
          httpClient,
          session: makeSession("kimi"),
          vendor: "kimi",
        },
        { pageSize: 1 },
      ),
    );

    expect(conversations).toHaveLength(COMPLETE_PAGE_COUNT);
    expect(calls).toHaveLength(COMPLETE_PAGE_COUNT);
    expect(conversations.at(-1).originalId).toBe(
      `kimi-${LEGACY_DEFAULT_MAX_PAGES}`,
    );
  });
});
