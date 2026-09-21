"use strict";

const { types: utilTypes } = require("node:util");

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_PPT_SLIDES = 512;
const MAX_PPT_POINTS = 4096;
const PPT_THEMES = new Set(["business", "academic", "creative", "dark"]);
const ALIGNMENTS = new Set(["left", "center", "right", "justify"]);

function validationError() {
  const error = new Error("AI Engine IPC request is invalid");
  error.code = "CC_AI_ENGINE_IPC_INVALID_REQUEST";
  return error;
}

function fail() {
  throw validationError();
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readRecord(value, allowedKeys, requiredKeys = []) {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    fail();
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (keys.some((key) => !allowedKeys.includes(key))) {
    fail();
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
      fail();
    }
  }

  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      fail();
    }
    result[key] = descriptor.value;
  }
  return result;
}

function readDenseArray(value, maximum) {
  if (
    !Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    fail();
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Object.keys(descriptors).filter((key) => key !== "length");
  if (ownKeys.length !== value.length) {
    fail();
  }

  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      fail();
    }
    result.push(descriptor.value);
  }
  return result;
}

function createBudget() {
  return { bytes: 0 };
}

function boundedString(value, budget, { minimum = 0, maximum, pattern } = {}) {
  if (typeof value !== "string") {
    fail();
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    value.length < minimum ||
    value.length > maximum ||
    bytes > maximum * 4 ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value) ||
    (pattern && !pattern.test(value))
  ) {
    fail();
  }
  budget.bytes += bytes;
  if (budget.bytes > MAX_REQUEST_BYTES) {
    fail();
  }
  return value;
}

function optionalString(value, budget, options) {
  return value === undefined
    ? undefined
    : boundedString(value, budget, options);
}

function boundedInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail();
  }
  return value;
}

function validateProjectId(value, budget) {
  return boundedString(value, budget, {
    minimum: 1,
    maximum: 256,
    pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/,
  });
}

function validatePPTRequest(value) {
  const budget = createBudget();
  const request = readRecord(
    value,
    ["projectId", "outline", "theme", "author"],
    ["projectId", "outline"],
  );
  const outline = readRecord(
    request.outline,
    ["title", "subtitle", "sections"],
    ["title", "sections"],
  );
  const sectionValues = readDenseArray(outline.sections, 64);
  let slideCount = sectionValues.length + 2;
  let pointCount = 0;
  const sections = sectionValues.map((sectionValue) => {
    const section = readRecord(
      sectionValue,
      ["title", "subsections"],
      ["title", "subsections"],
    );
    const subsectionValues = readDenseArray(section.subsections, 64);
    slideCount += subsectionValues.length;
    if (slideCount > MAX_PPT_SLIDES) {
      fail();
    }
    const subsections = subsectionValues.map((subsectionValue) => {
      const subsection = readRecord(
        subsectionValue,
        ["title", "points"],
        ["title", "points"],
      );
      const pointValues = readDenseArray(subsection.points, 64);
      pointCount += pointValues.length;
      if (pointCount > MAX_PPT_POINTS) {
        fail();
      }
      const points = pointValues.map((point) =>
        boundedString(point, budget, { minimum: 1, maximum: 4096 }),
      );
      return Object.freeze({
        title: boundedString(subsection.title, budget, {
          minimum: 1,
          maximum: 512,
        }),
        points: Object.freeze(points),
      });
    });
    return Object.freeze({
      title: boundedString(section.title, budget, {
        minimum: 1,
        maximum: 512,
      }),
      subsections: Object.freeze(subsections),
    });
  });

  const theme =
    request.theme === undefined
      ? "business"
      : boundedString(request.theme, budget, { minimum: 1, maximum: 32 });
  if (!PPT_THEMES.has(theme)) {
    fail();
  }

  return Object.freeze({
    projectId: validateProjectId(request.projectId, budget),
    outline: Object.freeze({
      title: boundedString(outline.title, budget, {
        minimum: 1,
        maximum: 512,
      }),
      ...(outline.subtitle === undefined
        ? {}
        : {
            subtitle: optionalString(outline.subtitle, budget, {
              maximum: 2048,
            }),
          }),
      sections: Object.freeze(sections),
    }),
    theme,
    author:
      request.author === undefined
        ? "作者"
        : boundedString(request.author, budget, { minimum: 1, maximum: 512 }),
  });
}

function validateStyle(value, budget) {
  if (value === undefined) {
    return Object.freeze({});
  }
  const style = readRecord(value, [
    "bold",
    "italic",
    "underline",
    "fontSize",
    "fontFamily",
    "color",
  ]);
  const result = {};
  for (const key of ["bold", "italic", "underline"]) {
    if (style[key] !== undefined) {
      if (typeof style[key] !== "boolean") {
        fail();
      }
      result[key] = style[key];
    }
  }
  if (style.fontSize !== undefined) {
    result.fontSize = boundedInteger(style.fontSize, 1, 200);
  }
  if (style.fontFamily !== undefined) {
    result.fontFamily = boundedString(style.fontFamily, budget, {
      minimum: 1,
      maximum: 128,
    });
  }
  if (style.color !== undefined) {
    result.color = boundedString(style.color, budget, {
      minimum: 6,
      maximum: 6,
      pattern: /^[0-9A-Fa-f]{6}$/,
    });
  }
  return Object.freeze(result);
}

function validateSpacing(value) {
  if (value === undefined) {
    return Object.freeze({ after: 200 });
  }
  const spacing = readRecord(value, ["before", "after", "line"]);
  const result = {};
  for (const key of ["before", "after", "line"]) {
    if (spacing[key] !== undefined) {
      result[key] = boundedInteger(spacing[key], 0, 100000);
    }
  }
  return Object.freeze(result);
}

function validateWordRequest(value) {
  const budget = createBudget();
  const request = readRecord(
    value,
    ["projectId", "structure"],
    ["projectId", "structure"],
  );
  const structure = readRecord(
    request.structure,
    ["title", "paragraphs"],
    ["title", "paragraphs"],
  );
  const paragraphs = readDenseArray(structure.paragraphs, 512).map(
    (paragraphValue) => {
      const paragraph = readRecord(
        paragraphValue,
        ["text", "heading", "alignment", "style", "spacing"],
        ["text"],
      );
      const result = {
        text: boundedString(paragraph.text, budget, {
          maximum: 16 * 1024,
        }),
        style: validateStyle(paragraph.style, budget),
        spacing: validateSpacing(paragraph.spacing),
      };
      if (paragraph.heading !== undefined) {
        result.heading = boundedInteger(paragraph.heading, 1, 6);
      }
      if (paragraph.alignment !== undefined) {
        const alignment = boundedString(paragraph.alignment, budget, {
          minimum: 1,
          maximum: 16,
        });
        if (!ALIGNMENTS.has(alignment)) {
          fail();
        }
        result.alignment = alignment;
      }
      return Object.freeze(result);
    },
  );

  return Object.freeze({
    projectId: validateProjectId(request.projectId, budget),
    structure: Object.freeze({
      title: boundedString(structure.title, budget, {
        minimum: 1,
        maximum: 512,
      }),
      paragraphs: Object.freeze(paragraphs),
    }),
  });
}

module.exports = {
  MAX_REQUEST_BYTES,
  validatePPTRequest,
  validateWordRequest,
};
