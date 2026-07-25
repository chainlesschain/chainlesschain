"use strict";

import { describe, expect, it } from "vitest";

const {
  extractRecognizedArray,
  isExplicitFailure,
} = require("../lib/source-page");
const publicApi = require("../lib");

describe("source page recognition", () => {
  const paths = [["list"], ["data", "records"]];

  it("is exported for adapters that share live JSON contracts", () => {
    expect(publicApi.extractRecognizedArray).toBe(extractRecognizedArray);
  });

  it("accepts only explicitly recognized array locations", () => {
    expect(extractRecognizedArray({ list: [] }, paths)).toEqual([]);
    expect(
      extractRecognizedArray({ data: { records: [{ id: 1 }] } }, paths),
    ).toEqual([{ id: 1 }]);
    expect(() => extractRecognizedArray({}, paths)).toThrow(
      expect.objectContaining({ code: "SOURCE_PAGE_UNRECOGNIZED" }),
    );
  });

  it("rejects explicit error payloads even if they also contain an empty list", () => {
    const response = {
      code: 401,
      message: "expired runtime cookie",
      list: [],
    };
    expect(isExplicitFailure(response)).toBe(true);
    expect(() => extractRecognizedArray(response, paths)).toThrow(
      expect.objectContaining({ code: "SOURCE_PAGE_ERROR" }),
    );
    expect(
      isExplicitFailure({
        data: { status: "unauthorized", records: [] },
      }),
    ).toBe(true);
  });

  it.each([
    [{ code: -1, list: [] }, undefined],
    [{ code: 10001, list: [] }, undefined],
    [{ code: "TOKEN_EXPIRED", list: [] }, undefined],
    [{ ret: -1, list: [] }, undefined],
    [{ retcode: 10001, list: [] }, undefined],
    [{ status: 10001, list: [] }, undefined],
    [{ statusCode: 302, list: [] }, undefined],
    [{ success: "false", list: [] }, undefined],
    [{ ok: 0, list: [] }, undefined],
    [{ code: 1, list: [] }, [1]],
  ])(
    "treats non-success business codes as errors unless explicitly configured",
    (response, successCodes) => {
      const options = successCodes ? { successCodes } : {};
      if (successCodes) {
        expect(extractRecognizedArray(response, paths, options)).toEqual([]);
      } else {
        expect(() => extractRecognizedArray(response, paths, options)).toThrow(
          expect.objectContaining({ code: "SOURCE_PAGE_ERROR" }),
        );
      }
    },
  );

  it("accepts conventional and explicitly configured success envelopes", () => {
    expect(extractRecognizedArray({ code: 0, list: [] }, paths)).toEqual([]);
    expect(extractRecognizedArray({ code: 200, list: [] }, paths)).toEqual([]);
    expect(
      extractRecognizedArray({ statusCode: 204, list: [] }, paths),
    ).toEqual([]);
    expect(extractRecognizedArray({ status: 1, list: [] }, paths)).toEqual([]);
    expect(
      extractRecognizedArray({ status: "complete", list: [] }, paths, {
        successStatuses: ["complete"],
      }),
    ).toEqual([]);
    expect(extractRecognizedArray({ status: true, list: [] }, paths)).toEqual(
      [],
    );
    expect(
      extractRecognizedArray({ ret: ["SUCCESS::调用成功"], list: [] }, paths),
    ).toEqual([]);
  });

  it("accepts a top-level list only when the empty path is explicit", () => {
    expect(extractRecognizedArray([{ id: 1 }], [[], ["list"]])).toEqual([
      { id: 1 },
    ]);
    expect(() => extractRecognizedArray([{ id: 1 }], [["list"]])).toThrow(
      expect.objectContaining({ code: "SOURCE_PAGE_UNRECOGNIZED" }),
    );
  });

  it("rejects an MTOP failure token even when a recognized list is present", () => {
    expect(() =>
      extractRecognizedArray(
        {
          ret: ["FAIL_SYS_SESSION_EXPIRED::会话过期"],
          data: { list: [] },
        },
        paths,
      ),
    ).toThrow(expect.objectContaining({ code: "SOURCE_PAGE_ERROR" }));
  });

  it("does not echo response bodies or credentials in errors", () => {
    const secret = "sid=runtime-secret";
    let failure;
    try {
      extractRecognizedArray({ code: 403, message: secret }, paths, {
        source: "example",
        stream: "history",
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "SOURCE_PAGE_ERROR" });
    expect(String(failure)).not.toContain(secret);
  });
});
