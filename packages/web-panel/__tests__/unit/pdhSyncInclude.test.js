import { describe, expect, it } from "vitest";
import {
  buildSyncIncludeOptions,
  createDefaultSyncInclude,
  DEFAULT_SYNC_INCLUDE,
  INCLUDE_KIND_META,
} from "../../src/utils/pdhSyncInclude.js";

const ANDROID_INCLUDE_KEYS = ["contacts", "apps", "sms", "calls", "media"];

describe("Personal Data Hub source include controls", () => {
  it("defines all five Android collection switches as enabled by default", () => {
    expect(
      INCLUDE_KIND_META["system-data-android"].map(({ key }) => key),
    ).toEqual(ANDROID_INCLUDE_KEYS);
    expect(DEFAULT_SYNC_INCLUDE["system-data-android"]).toEqual({
      contacts: true,
      apps: true,
      sms: true,
      calls: true,
      media: true,
    });
  });

  it("builds registry sync options with every Android switch turned off", () => {
    const includeByAdapter = createDefaultSyncInclude();
    for (const key of ANDROID_INCLUDE_KEYS) {
      includeByAdapter["system-data-android"][key] = false;
    }

    expect(
      buildSyncIncludeOptions("system-data-android", includeByAdapter),
    ).toEqual({
      include: {
        contacts: false,
        apps: false,
        sms: false,
        calls: false,
        media: false,
      },
    });
  });

  it("does not add include options to sources without collection controls", () => {
    expect(buildSyncIncludeOptions("email-imap", {})).toEqual({});
  });
});
