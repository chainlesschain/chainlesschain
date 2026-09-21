import { describe, expect, it } from "vitest";

const {
  MAX_REQUEST_BYTES,
  validatePPTRequest,
  validateWordRequest,
} = require("../../../src/main/ai-engine/ai-engine-ipc-input.js");

function validPPTRequest() {
  return {
    outline: {
      title: "Release plan",
      subtitle: "Autumn",
      sections: [
        {
          title: "Status",
          subsections: [
            { title: "Delivered", points: ["Authorization", "Validation"] },
          ],
        },
      ],
    },
    theme: "dark",
    author: "Operator",
    outputPath: "/tmp/release.pptx",
  };
}

function validWordRequest() {
  return {
    structure: {
      title: "Release plan",
      paragraphs: [
        {
          text: "Delivered",
          heading: 1,
          alignment: "center",
          style: {
            bold: true,
            italic: false,
            underline: false,
            fontSize: 18,
            fontFamily: "Arial",
            color: "112233",
          },
          spacing: { before: 100, after: 200, line: 240 },
        },
      ],
    },
    outputPath: "/tmp/release.docx",
  };
}

describe("AI Engine IPC input validation", () => {
  it("copies and freezes the supported PPT data shape", () => {
    const input = validPPTRequest();
    const result = validatePPTRequest(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(
      Object.isFrozen(result.outline.sections[0].subsections[0].points),
    ).toBe(true);
  });

  it("copies and freezes the supported Word data shape", () => {
    const input = validWordRequest();
    const result = validateWordRequest(input);

    expect(result).toEqual(input);
    expect(result.structure.paragraphs[0]).not.toBe(
      input.structure.paragraphs[0],
    );
    expect(Object.isFrozen(result.structure.paragraphs[0].style)).toBe(true);
  });

  it.each([
    ["proxy", () => new Proxy(validPPTRequest(), {})],
    [
      "accessor",
      () => {
        const request = validPPTRequest();
        Object.defineProperty(request, "theme", {
          enumerable: true,
          get: () => "business",
        });
        return request;
      },
    ],
    ["unknown field", () => ({ ...validPPTRequest(), privileged: true })],
    ["unknown theme", () => ({ ...validPPTRequest(), theme: "remote" })],
    [
      "dangerous control character",
      () => ({ ...validPPTRequest(), author: "operator\u0000admin" }),
    ],
    [
      "wrong extension",
      () => ({ ...validPPTRequest(), outputPath: "/tmp/release.exe" }),
    ],
    [
      "relative output path",
      () => ({ ...validPPTRequest(), outputPath: "release.pptx" }),
    ],
    [
      "sparse section list",
      () => {
        const request = validPPTRequest();
        request.outline.sections = new Array(1);
        return request;
      },
    ],
    [
      "oversized point",
      () => {
        const request = validPPTRequest();
        request.outline.sections[0].subsections[0].points = [
          "x".repeat(MAX_REQUEST_BYTES + 1),
        ];
        return request;
      },
    ],
    [
      "oversized section collection",
      () => {
        const request = validPPTRequest();
        request.outline.sections = Array.from({ length: 65 }, (_, index) => ({
          title: `Section ${index}`,
          subsections: [],
        }));
        return request;
      },
    ],
    [
      "oversized total byte budget",
      () => {
        const request = validPPTRequest();
        request.outline.sections[0].subsections = Array.from(
          { length: 3 },
          (_, subsectionIndex) => ({
            title: `Part ${subsectionIndex}`,
            points: Array.from({ length: subsectionIndex === 2 ? 1 : 64 }, () =>
              "x".repeat(4096),
            ),
          }),
        );
        return request;
      },
    ],
  ])("rejects unsafe PPT %s", (_label, requestFactory) => {
    expect(() => validatePPTRequest(requestFactory())).toThrowError(
      expect.objectContaining({ code: "CC_AI_ENGINE_IPC_INVALID_REQUEST" }),
    );
  });

  it.each([
    [
      "rich text array",
      () => {
        const request = validWordRequest();
        request.structure.paragraphs[0].text = [{ text: "unsafe expansion" }];
        return request;
      },
    ],
    [
      "unknown paragraph field",
      () => {
        const request = validWordRequest();
        request.structure.paragraphs[0].command = "run";
        return request;
      },
    ],
    [
      "invalid heading",
      () => {
        const request = validWordRequest();
        request.structure.paragraphs[0].heading = 7;
        return request;
      },
    ],
    [
      "invalid color",
      () => {
        const request = validWordRequest();
        request.structure.paragraphs[0].style.color = "red";
        return request;
      },
    ],
    [
      "wrong extension",
      () => ({ ...validWordRequest(), outputPath: "/tmp/release.txt" }),
    ],
  ])("rejects unsafe Word %s", (_label, requestFactory) => {
    expect(() => validateWordRequest(requestFactory())).toThrowError(
      expect.objectContaining({ code: "CC_AI_ENGINE_IPC_INVALID_REQUEST" }),
    );
  });
});
