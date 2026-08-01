/** Unicode-aware, ANSI-free layout helpers for small terminal surfaces. */

const graphemeSegmenter =
  typeof Intl?.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function graphemes(value) {
  const text = String(value ?? "");
  return graphemeSegmenter
    ? [...graphemeSegmenter.segment(text)].map((part) => part.segment)
    : [...text];
}

function isFullWidthCodePoint(codePoint) {
  if (!Number.isInteger(codePoint)) return false;
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) ||
      (codePoint >= 0x3250 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0xa4c6) ||
      (codePoint >= 0xa960 && codePoint <= 0xa97c) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6b) ||
      (codePoint >= 0xff01 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1b000 && codePoint <= 0x1b2ff) ||
      (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

export function graphemeDisplayWidth(grapheme) {
  const value = String(grapheme || "");
  if (!value || /^[\p{Mark}\p{Cf}\p{Cc}]+$/u.test(value)) return 0;
  if (/\p{Extended_Pictographic}/u.test(value)) return 2;
  for (const character of value) {
    if (isFullWidthCodePoint(character.codePointAt(0))) return 2;
  }
  return 1;
}

export function terminalDisplayWidth(value) {
  return graphemes(value).reduce(
    (width, grapheme) => width + graphemeDisplayWidth(grapheme),
    0,
  );
}

/** Hard-wrap by grapheme without reversing RTL logical order. */
export function wrapTerminalText(value, columns = 80) {
  const width = Math.max(8, Math.floor(Number(columns) || 80));
  const output = [];
  for (const sourceLine of String(value ?? "").split("\n")) {
    if (!sourceLine) {
      output.push("");
      continue;
    }
    let line = "";
    let lineWidth = 0;
    for (const grapheme of graphemes(sourceLine)) {
      const nextWidth = graphemeDisplayWidth(grapheme);
      if (line && lineWidth + nextWidth > width) {
        output.push(line);
        line = "";
        lineWidth = 0;
      }
      line += grapheme;
      lineWidth += nextWidth;
    }
    output.push(line);
  }
  return output.join("\n");
}

/** Screen readers prefer stable logical lines; visual terminals hard-wrap. */
export function layoutTerminalText(
  value,
  { columns = 80, screenReader = false } = {},
) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  return screenReader ? text : wrapTerminalText(text, columns);
}
