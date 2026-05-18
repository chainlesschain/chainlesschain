/**
 * Color Picker Skill Handler
 *
 * Color conversion, palette generation, contrast checking, and design utilities.
 * Actions: --convert, --palette, --contrast, --lighten, --darken, --mix, --random, --named
 */

const { logger } = require("../../../../../utils/logger.js");

// ── CSS Named Colors (140 standard colors) ──────────────────────────

const CSS_NAMED_COLORS = {
  aliceblue: "#f0f8ff",
  antiquewhite: "#faebd7",
  aqua: "#00ffff",
  aquamarine: "#7fffd4",
  azure: "#f0ffff",
  beige: "#f5f5dc",
  bisque: "#ffe4c4",
  black: "#000000",
  blanchedalmond: "#ffebcd",
  blue: "#0000ff",
  blueviolet: "#8a2be2",
  brown: "#a52a2a",
  burlywood: "#deb887",
  cadetblue: "#5f9ea0",
  chartreuse: "#7fff00",
  chocolate: "#d2691e",
  coral: "#ff7f50",
  cornflowerblue: "#6495ed",
  cornsilk: "#fff8dc",
  crimson: "#dc143c",
  cyan: "#00ffff",
  darkblue: "#00008b",
  darkcyan: "#008b8b",
  darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9",
  darkgreen: "#006400",
  darkgrey: "#a9a9a9",
  darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b",
  darkolivegreen: "#556b2f",
  darkorange: "#ff8c00",
  darkorchid: "#9932cc",
  darkred: "#8b0000",
  darksalmon: "#e9967a",
  darkseagreen: "#8fbc8f",
  darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
  darkturquoise: "#00ced1",
  darkviolet: "#9400d3",
  deeppink: "#ff1493",
  deepskyblue: "#00bfff",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1e90ff",
  firebrick: "#b22222",
  floralwhite: "#fffaf0",
  forestgreen: "#228b22",
  fuchsia: "#ff00ff",
  gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff",
  gold: "#ffd700",
  goldenrod: "#daa520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#adff2f",
  grey: "#808080",
  honeydew: "#f0fff0",
  hotpink: "#ff69b4",
  indianred: "#cd5c5c",
  indigo: "#4b0082",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  lavender: "#e6e6fa",
  lavenderblush: "#fff0f5",
  lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd",
  lightblue: "#add8e6",
  lightcoral: "#f08080",
  lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2",
  lightgray: "#d3d3d3",
  lightgreen: "#90ee90",
  lightgrey: "#d3d3d3",
  lightpink: "#ffb6c1",
  lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#b0c4de",
  lightyellow: "#ffffe0",
  lime: "#00ff00",
  limegreen: "#32cd32",
  linen: "#faf0e6",
  magenta: "#ff00ff",
  maroon: "#800000",
  mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd",
  mediumorchid: "#ba55d3",
  mediumpurple: "#9370db",
  mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee",
  mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585",
  midnightblue: "#191970",
  mintcream: "#f5fffa",
  mistyrose: "#ffe4e1",
  moccasin: "#ffe4b5",
  navajowhite: "#ffdead",
  navy: "#000080",
  oldlace: "#fdf5e6",
  olive: "#808000",
  olivedrab: "#6b8e23",
  orange: "#ffa500",
  orangered: "#ff4500",
  orchid: "#da70d6",
  palegoldenrod: "#eee8aa",
  palegreen: "#98fb98",
  paleturquoise: "#afeeee",
  palevioletred: "#db7093",
  papayawhip: "#ffefd5",
  peachpuff: "#ffdab9",
  peru: "#cd853f",
  pink: "#ffc0cb",
  plum: "#dda0dd",
  powderblue: "#b0e0e6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#ff0000",
  rosybrown: "#bc8f8f",
  royalblue: "#4169e1",
  saddlebrown: "#8b4513",
  salmon: "#fa8072",
  sandybrown: "#f4a460",
  seagreen: "#2e8b57",
  seashell: "#fff5ee",
  sienna: "#a0522d",
  silver: "#c0c0c0",
  skyblue: "#87ceeb",
  slateblue: "#6a5acd",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#fffafa",
  springgreen: "#00ff7f",
  steelblue: "#4682b4",
  tan: "#d2b48c",
  teal: "#008080",
  thistle: "#d8bfd8",
  tomato: "#ff6347",
  turquoise: "#40e0d0",
  violet: "#ee82ee",
  wheat: "#f5deb3",
  white: "#ffffff",
  whitesmoke: "#f5f5f5",
  yellow: "#ffff00",
  yellowgreen: "#9acd32",
};

// ── Color Conversion Functions ──────────────────────────────────────

function hexToRgb(hex) {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((c) => {
        const h = Math.max(0, Math.min(255, Math.round(c))).toString(16);
        return h.length === 1 ? "0" + h : h;
      })
      .join("")
  );
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const hueToRgb = (p, q, t) => {
    if (t < 0) {
      t += 1;
    }
    if (t > 1) {
      t -= 1;
    }
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;

  return {
    r: Math.round(hueToRgb(p, q, hNorm + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, hNorm) * 255),
    b: Math.round(hueToRgb(p, q, hNorm - 1 / 3) * 255),
  };
}

// ── Color Parsing ───────────────────────────────────────────────────

function parseColor(input) {
  if (!input) {
    return null;
  }
  const str = input.trim().toLowerCase();

  // Check CSS named colors first
  if (CSS_NAMED_COLORS[str]) {
    const rgb = hexToRgb(CSS_NAMED_COLORS[str]);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return {
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      h: hsl.h,
      s: hsl.s,
      l: hsl.l,
      source: "named",
    };
  }

  // HEX: #rgb or #rrggbb
  const hexMatch = str.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexMatch) {
    const hex =
      hexMatch[1].length === 3
        ? hexMatch[1][0] +
          hexMatch[1][0] +
          hexMatch[1][1] +
          hexMatch[1][1] +
          hexMatch[1][2] +
          hexMatch[1][2]
        : hexMatch[1];
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return {
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      h: hsl.h,
      s: hsl.s,
      l: hsl.l,
      source: "hex",
    };
  }

  // RGB: rgb(r, g, b) or rgb(r g b)
  const rgbMatch = str.match(
    /^rgb\s*\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/,
  );
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    if (r > 255 || g > 255 || b > 255) {
      return null;
    }
    const hsl = rgbToHsl(r, g, b);
    return { r, g, b, h: hsl.h, s: hsl.s, l: hsl.l, source: "rgb" };
  }

  // HSL: hsl(h, s%, l%) or hsl(h s% l%)
  const hslMatch = str.match(
    /^hsl\s*\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})%?\s*[,\s]\s*(\d{1,3})%?\s*\)$/,
  );
  if (hslMatch) {
    const h = parseInt(hslMatch[1], 10);
    const s = parseInt(hslMatch[2], 10);
    const l = parseInt(hslMatch[3], 10);
    const rgb = hslToRgb(h, s, l);
    return { r: rgb.r, g: rgb.g, b: rgb.b, h, s, l, source: "hsl" };
  }

  return null;
}

function formatColor(color) {
  const hex = rgbToHex(color.r, color.g, color.b);
  const rgb = "rgb(" + color.r + ", " + color.g + ", " + color.b + ")";
  const hsl = "hsl(" + color.h + ", " + color.s + "%, " + color.l + "%)";
  return { hex, rgb, hsl };
}

// ── WCAG Contrast ───────────────────────────────────────────────────

function relativeLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(color1, color2) {
  const l1 = relativeLuminance(color1.r, color1.g, color1.b);
  const l2 = relativeLuminance(color2.r, color2.g, color2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Palette Generation ──────────────────────────────────────────────

function rotateHue(color, degrees) {
  const newH = (((color.h + degrees) % 360) + 360) % 360;
  const rgb = hslToRgb(newH, color.s, color.l);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return { r: rgb.r, g: rgb.g, b: rgb.b, h: hsl.h, s: hsl.s, l: hsl.l };
}

function generatePalette(color, type) {
  const colors = [color];
  switch (type) {
    case "complementary":
      colors.push(rotateHue(color, 180));
      break;
    case "analogous":
      colors.push(rotateHue(color, 30));
      colors.push(rotateHue(color, -30));
      break;
    case "triadic":
      colors.push(rotateHue(color, 120));
      colors.push(rotateHue(color, 240));
      break;
    case "split":
      colors.push(rotateHue(color, 150));
      colors.push(rotateHue(color, 210));
      break;
    case "tetradic":
      colors.push(rotateHue(color, 90));
      colors.push(rotateHue(color, 180));
      colors.push(rotateHue(color, 270));
      break;
    default:
      colors.push(rotateHue(color, 180));
      break;
  }
  return colors;
}

// ── Color Manipulation ──────────────────────────────────────────────

function lightenColor(color, amount) {
  const newL = Math.min(100, color.l + amount);
  const rgb = hslToRgb(color.h, color.s, newL);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return { r: rgb.r, g: rgb.g, b: rgb.b, h: hsl.h, s: hsl.s, l: hsl.l };
}

function darkenColor(color, amount) {
  const newL = Math.max(0, color.l - amount);
  const rgb = hslToRgb(color.h, color.s, newL);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return { r: rgb.r, g: rgb.g, b: rgb.b, h: hsl.h, s: hsl.s, l: hsl.l };
}

function mixColors(color1, color2, ratio) {
  const w1 = ratio / 100;
  const w2 = 1 - w1;
  const r = Math.round(color1.r * w1 + color2.r * w2);
  const g = Math.round(color1.g * w1 + color2.g * w2);
  const b = Math.round(color1.b * w1 + color2.b * w2);
  const hsl = rgbToHsl(r, g, b);
  return { r, g, b, h: hsl.h, s: hsl.s, l: hsl.l };
}

function randomColor() {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  const hsl = rgbToHsl(r, g, b);
  return { r, g, b, h: hsl.h, s: hsl.s, l: hsl.l };
}

// ── Argument Parsing Helpers ────────────────────────────────────────

function extractColorArg(input, flag) {
  // Match --flag "value" or --flag 'value' or --flag value (color values may contain parens/commas)
  const reQuoted = new RegExp(flag + '\\s+"([^"]*)"', "i");
  const m1 = input.match(reQuoted);
  if (m1) {
    return m1[1];
  }

  const reSingleQuoted = new RegExp(flag + "\\s+'([^']*)'", "i");
  const m2 = input.match(reSingleQuoted);
  if (m2) {
    return m2[1];
  }

  // Match color with parens: --flag rgb(1,2,3) or --flag hsl(1,2%,3%)
  const reParen = new RegExp(flag + "\\s+((?:rgb|hsl)\\s*\\([^)]+\\))", "i");
  const m3 = input.match(reParen);
  if (m3) {
    return m3[1];
  }

  // Match simple value (hex or named)
  const reSimple = new RegExp(flag + "\\s+(\\S+)", "i");
  const m4 = input.match(reSimple);
  return m4 ? m4[1] : null;
}

function extractNumberArg(input, flag, defaultVal) {
  const re = new RegExp(flag + "\\s+(\\d+)", "i");
  const m = input.match(re);
  return m ? parseInt(m[1], 10) : defaultVal;
}

function extractStringArg(input, flag) {
  const re = new RegExp(flag + "\\s+(\\S+)", "i");
  const m = input.match(re);
  return m ? m[1].toLowerCase() : null;
}

function formatColorLine(color) {
  const fmt = formatColor(color);
  return "HEX: " + fmt.hex + " | RGB: " + fmt.rgb + " | HSL: " + fmt.hsl;
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info("[color-picker] init: " + (skill?.name || "color-picker"));
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const _projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    const isConvert = /--convert\s/i.test(input);
    const isPalette = /--palette\s/i.test(input);
    const isContrast = /--contrast\s/i.test(input);
    const isLighten = /--lighten\s/i.test(input);
    const isDarken = /--darken\s/i.test(input);
    const isMix = /--mix\s/i.test(input);
    const isRandom = /--random/i.test(input);
    const isNamed = /--named\s/i.test(input);

    try {
      // ── --convert <color> ───────────────────────────────────────
      if (isConvert) {
        const raw = extractColorArg(input, "--convert");
        if (!raw) {
          return {
            success: false,
            result: {},
            message: "Usage: --convert <color>  (e.g. --convert #ff5733)",
          };
        }
        const color = parseColor(raw);
        if (!color) {
          return {
            success: false,
            result: {},
            message:
              "Invalid color: " +
              raw +
              ". Supported: HEX (#ff5733), RGB (rgb(255,87,51)), HSL (hsl(11,100%,60%)), or CSS name.",
          };
        }
        const fmt = formatColor(color);
        let msg = "Color Conversion\n" + "=".repeat(30) + "\n";
        msg += "Input:  " + raw + "\n\n";
        msg += "HEX:  " + fmt.hex + "\n";
        msg += "RGB:  " + fmt.rgb + "\n";
        msg += "HSL:  " + fmt.hsl + "\n";

        return {
          success: true,
          result: { input: raw, hex: fmt.hex, rgb: fmt.rgb, hsl: fmt.hsl },
          message: msg,
        };
      }

      // ── --palette <color> [--type <harmony>] ────────────────────
      if (isPalette) {
        const raw = extractColorArg(input, "--palette");
        if (!raw) {
          return {
            success: false,
            result: {},
            message:
              "Usage: --palette <color> [--type complementary|analogous|triadic|split|tetradic]",
          };
        }
        const color = parseColor(raw);
        if (!color) {
          return {
            success: false,
            result: {},
            message: "Invalid color: " + raw,
          };
        }
        const type = extractStringArg(input, "--type") || "complementary";
        const validTypes = [
          "complementary",
          "analogous",
          "triadic",
          "split",
          "tetradic",
        ];
        if (!validTypes.includes(type)) {
          return {
            success: false,
            result: {},
            message:
              "Invalid palette type: " +
              type +
              ". Valid: " +
              validTypes.join(", "),
          };
        }

        const palette = generatePalette(color, type);
        const paletteFormatted = palette.map((c) => formatColor(c));

        let msg = "Color Palette (" + type + ")\n" + "=".repeat(30) + "\n";
        msg += "Base: " + formatColorLine(color) + "\n\n";
        for (let i = 0; i < paletteFormatted.length; i++) {
          const label = i === 0 ? "Base    " : "Color " + i + " ";
          msg +=
            label +
            ": " +
            paletteFormatted[i].hex +
            " | " +
            paletteFormatted[i].rgb +
            " | " +
            paletteFormatted[i].hsl +
            "\n";
        }

        return {
          success: true,
          result: { base: raw, type, palette: paletteFormatted },
          message: msg,
        };
      }

      // ── --contrast <color1> <color2> ────────────────────────────
      if (isContrast) {
        // Extract two colors after --contrast
        const afterContrast = input.replace(/^.*--contrast\s+/i, "");
        let color1Raw = null;
        let color2Raw = null;

        // Try to extract two colors: could be hex, rgb(), hsl(), or named
        const colorTokens = [];
        let remaining = afterContrast.trim();

        // Iteratively extract colors
        for (let attempt = 0; attempt < 2; attempt++) {
          remaining = remaining.trim();
          if (!remaining) {
            break;
          }

          // Check for rgb(...) or hsl(...)
          const funcMatch = remaining.match(/^((?:rgb|hsl)\s*\([^)]+\))\s*/i);
          if (funcMatch) {
            colorTokens.push(funcMatch[1]);
            remaining = remaining.substring(funcMatch[0].length);
            continue;
          }

          // Check for quoted value
          const quotedMatch = remaining.match(/^"([^"]*)"\s*/);
          if (quotedMatch) {
            colorTokens.push(quotedMatch[1]);
            remaining = remaining.substring(quotedMatch[0].length);
            continue;
          }

          // Check for simple token (hex or named), stop at next flag
          const simpleMatch = remaining.match(/^(\S+)\s*/);
          if (simpleMatch && !simpleMatch[1].startsWith("--")) {
            colorTokens.push(simpleMatch[1]);
            remaining = remaining.substring(simpleMatch[0].length);
            continue;
          }
          break;
        }

        color1Raw = colorTokens[0] || null;
        color2Raw = colorTokens[1] || null;

        if (!color1Raw || !color2Raw) {
          return {
            success: false,
            result: {},
            message:
              "Usage: --contrast <color1> <color2>  (e.g. --contrast #ffffff #000000)",
          };
        }

        const color1 = parseColor(color1Raw);
        const color2 = parseColor(color2Raw);
        if (!color1) {
          return {
            success: false,
            result: {},
            message: "Invalid first color: " + color1Raw,
          };
        }
        if (!color2) {
          return {
            success: false,
            result: {},
            message: "Invalid second color: " + color2Raw,
          };
        }

        const ratio = contrastRatio(color1, color2);
        const ratioRounded = Math.round(ratio * 100) / 100;
        const aaNormal = ratio >= 4.5;
        const aaLarge = ratio >= 3;
        const aaaNormal = ratio >= 7;
        const aaaLarge = ratio >= 4.5;

        let msg = "WCAG Contrast Check\n" + "=".repeat(30) + "\n";
        msg += "Color 1: " + formatColorLine(color1) + "\n";
        msg += "Color 2: " + formatColorLine(color2) + "\n\n";
        msg += "Contrast Ratio: " + ratioRounded + ":1\n\n";
        msg += "WCAG Results:\n";
        msg +=
          "  AA  Normal text (>=4.5:1):  " +
          (aaNormal ? "Pass" : "Fail") +
          "\n";
        msg +=
          "  AA  Large text   (>=3:1):   " + (aaLarge ? "Pass" : "Fail") + "\n";
        msg +=
          "  AAA Normal text (>=7:1):    " +
          (aaaNormal ? "Pass" : "Fail") +
          "\n";
        msg +=
          "  AAA Large text   (>=4.5:1): " +
          (aaaLarge ? "Pass" : "Fail") +
          "\n";

        return {
          success: true,
          result: {
            color1: formatColor(color1),
            color2: formatColor(color2),
            ratio: ratioRounded,
            wcag: {
              aa: { normal: aaNormal, large: aaLarge },
              aaa: { normal: aaaNormal, large: aaaLarge },
            },
          },
          message: msg,
        };
      }

      // ── --lighten <color> [--amount <percent>] ──────────────────
      if (isLighten) {
        const raw = extractColorArg(input, "--lighten");
        if (!raw) {
          return {
            success: false,
            result: {},
            message:
              "Usage: --lighten <color> [--amount <percent>]  (default 20%)",
          };
        }
        const color = parseColor(raw);
        if (!color) {
          return {
            success: false,
            result: {},
            message: "Invalid color: " + raw,
          };
        }
        const amount = extractNumberArg(input, "--amount", 20);
        const result = lightenColor(color, amount);
        const originalFmt = formatColor(color);
        const resultFmt = formatColor(result);

        let msg = "Lighten Color\n" + "=".repeat(30) + "\n";
        msg += "Original: " + formatColorLine(color) + "\n";
        msg += "Amount:   " + amount + "%\n";
        msg += "Result:   " + formatColorLine(result) + "\n";

        return {
          success: true,
          result: { original: originalFmt, amount, lightened: resultFmt },
          message: msg,
        };
      }

      // ── --darken <color> [--amount <percent>] ───────────────────
      if (isDarken) {
        const raw = extractColorArg(input, "--darken");
        if (!raw) {
          return {
            success: false,
            result: {},
            message:
              "Usage: --darken <color> [--amount <percent>]  (default 20%)",
          };
        }
        const color = parseColor(raw);
        if (!color) {
          return {
            success: false,
            result: {},
            message: "Invalid color: " + raw,
          };
        }
        const amount = extractNumberArg(input, "--amount", 20);
        const result = darkenColor(color, amount);
        const originalFmt = formatColor(color);
        const resultFmt = formatColor(result);

        let msg = "Darken Color\n" + "=".repeat(30) + "\n";
        msg += "Original: " + formatColorLine(color) + "\n";
        msg += "Amount:   " + amount + "%\n";
        msg += "Result:   " + formatColorLine(result) + "\n";

        return {
          success: true,
          result: { original: originalFmt, amount, darkened: resultFmt },
          message: msg,
        };
      }

      // ── --mix <color1> <color2> [--ratio <0-100>] ───────────────
      if (isMix) {
        // Extract two colors after --mix
        const afterMix = input.replace(/^.*--mix\s+/i, "");
        const colorTokens = [];
        let remaining = afterMix.trim();

        for (let attempt = 0; attempt < 2; attempt++) {
          remaining = remaining.trim();
          if (!remaining) {
            break;
          }

          const funcMatch = remaining.match(/^((?:rgb|hsl)\s*\([^)]+\))\s*/i);
          if (funcMatch) {
            colorTokens.push(funcMatch[1]);
            remaining = remaining.substring(funcMatch[0].length);
            continue;
          }
          const quotedMatch = remaining.match(/^"([^"]*)"\s*/);
          if (quotedMatch) {
            colorTokens.push(quotedMatch[1]);
            remaining = remaining.substring(quotedMatch[0].length);
            continue;
          }
          const simpleMatch = remaining.match(/^(\S+)\s*/);
          if (simpleMatch && !simpleMatch[1].startsWith("--")) {
            colorTokens.push(simpleMatch[1]);
            remaining = remaining.substring(simpleMatch[0].length);
            continue;
          }
          break;
        }

        const color1Raw = colorTokens[0] || null;
        const color2Raw = colorTokens[1] || null;

        if (!color1Raw || !color2Raw) {
          return {
            success: false,
            result: {},
            message:
              "Usage: --mix <color1> <color2> [--ratio <0-100>]  (default 50%)",
          };
        }

        const color1 = parseColor(color1Raw);
        const color2 = parseColor(color2Raw);
        if (!color1) {
          return {
            success: false,
            result: {},
            message: "Invalid first color: " + color1Raw,
          };
        }
        if (!color2) {
          return {
            success: false,
            result: {},
            message: "Invalid second color: " + color2Raw,
          };
        }

        const ratio = extractNumberArg(input, "--ratio", 50);
        const clampedRatio = Math.max(0, Math.min(100, ratio));
        const mixed = mixColors(color1, color2, clampedRatio);

        let msg = "Mix Colors\n" + "=".repeat(30) + "\n";
        msg +=
          "Color 1: " + formatColorLine(color1) + " (" + clampedRatio + "%)\n";
        msg +=
          "Color 2: " +
          formatColorLine(color2) +
          " (" +
          (100 - clampedRatio) +
          "%)\n";
        msg += "Result:  " + formatColorLine(mixed) + "\n";

        return {
          success: true,
          result: {
            color1: formatColor(color1),
            color2: formatColor(color2),
            ratio: clampedRatio,
            mixed: formatColor(mixed),
          },
          message: msg,
        };
      }

      // ── --random [--count <n>] ──────────────────────────────────
      if (isRandom) {
        const count = Math.max(
          1,
          Math.min(50, extractNumberArg(input, "--count", 1)),
        );
        const colors = [];
        for (let i = 0; i < count; i++) {
          colors.push(randomColor());
        }

        let msg =
          "Random Color" +
          (count > 1 ? "s" : "") +
          "\n" +
          "=".repeat(30) +
          "\n";
        for (let i = 0; i < colors.length; i++) {
          msg += "  " + (i + 1) + ". " + formatColorLine(colors[i]) + "\n";
        }

        return {
          success: true,
          result: { count, colors: colors.map((c) => formatColor(c)) },
          message: msg,
        };
      }

      // ── --named <name> ─────────────────────────────────────────
      if (isNamed) {
        const nameArg = extractStringArg(input, "--named");
        if (!nameArg) {
          return {
            success: false,
            result: {},
            message: "Usage: --named <color-name>  (e.g. --named coral)",
          };
        }

        const name = nameArg.toLowerCase();

        // Exact match
        if (CSS_NAMED_COLORS[name]) {
          const color = parseColor(CSS_NAMED_COLORS[name]);
          const fmt = formatColor(color);
          let msg = "CSS Named Color\n" + "=".repeat(30) + "\n";
          msg += "Name: " + name + "\n";
          msg += "HEX:  " + fmt.hex + "\n";
          msg += "RGB:  " + fmt.rgb + "\n";
          msg += "HSL:  " + fmt.hsl + "\n";

          return {
            success: true,
            result: { name, hex: fmt.hex, rgb: fmt.rgb, hsl: fmt.hsl },
            message: msg,
          };
        }

        // Fuzzy search
        const matches = Object.entries(CSS_NAMED_COLORS).filter(([k]) =>
          k.includes(name),
        );

        if (matches.length > 0) {
          let msg =
            "CSS Named Colors matching '" +
            name +
            "'\n" +
            "=".repeat(30) +
            "\n";
          msg += matches.length + " match(es) found:\n\n";
          for (const [k, hex] of matches) {
            const color = parseColor(hex);
            msg += "  " + k.padEnd(22) + " " + formatColorLine(color) + "\n";
          }
          return {
            success: true,
            result: {
              query: name,
              matches: matches.map(([k, hex]) => {
                const c = parseColor(hex);
                const f = formatColor(c);
                return { name: k, hex: f.hex, rgb: f.rgb, hsl: f.hsl };
              }),
            },
            message: msg,
          };
        }

        return {
          success: false,
          result: {},
          message:
            "Color name '" +
            name +
            "' not found. Use --named list to see all 140 CSS named colors.",
        };
      }

      // ── No input — show usage ───────────────────────────────────
      if (!input) {
        return {
          success: true,
          result: {},
          message:
            "Color Picker\n" +
            "=".repeat(20) +
            "\nUsage:\n" +
            "  /color-picker --convert <color>                         Convert between HEX, RGB, HSL\n" +
            "  /color-picker --palette <color> [--type <harmony>]      Generate color harmonies\n" +
            "  /color-picker --contrast <color1> <color2>              WCAG contrast ratio check\n" +
            "  /color-picker --lighten <color> [--amount <percent>]    Lighten color (default 20%)\n" +
            "  /color-picker --darken <color> [--amount <percent>]     Darken color (default 20%)\n" +
            "  /color-picker --mix <color1> <color2> [--ratio <0-100>] Mix two colors (default 50%)\n" +
            "  /color-picker --random [--count <n>]                    Generate random colors\n" +
            "  /color-picker --named <name>                            Look up CSS named color\n\n" +
            "Color formats: #ff5733, rgb(255,87,51), hsl(11,100%,60%), or CSS name\n" +
            "Palette types: complementary, analogous, triadic, split, tetradic\n",
        };
      }

      // Default: treat as --convert
      return await module.exports.execute(
        { input: "--convert " + input },
        context,
        _skill,
      );
    } catch (err) {
      logger.error("[color-picker] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Color picker failed: " + err.message,
      };
    }
  },
};
