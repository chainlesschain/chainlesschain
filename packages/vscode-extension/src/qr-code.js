/**
 * Self-contained QR code encoder — byte mode, error-correction level M,
 * automatic version 1–40 (ISO/IEC 18004). No dependencies: the extension
 * ships no node_modules, so the pairing-URI QR (Remote Control) must be
 * generated in-process. Java twin: com.chainlesschain.ide.QrCode — keep the
 * two byte-identical (shared fixtures in vscode-ext-qr-code.test.js /
 * QrCodeTest.java).
 *
 * `encodeQr(text)` returns `{ size, modules }` where `modules[y][x]` is true
 * for dark. `qrToSvg(qr)` renders a crisp deterministic SVG for webviews.
 * Pure Node (no vscode import).
 */
"use strict";

// ECC level M tables, versions 1..40 (ISO 18004 table 13).
const ECC_M_CODEWORDS_PER_BLOCK = [
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
  26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28,
];
const ECC_M_NUM_BLOCKS = [
  1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18,
  20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];
const FORMAT_ECL_M_BITS = 0; // L=1, M=0, Q=3, H=2

// GF(256) multiply, reducing by the QR polynomial 0x11D.
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Reed-Solomon generator polynomial coefficients for the given degree. */
function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** Reed-Solomon remainder of data divided by the generator polynomial. */
function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= gfMul(divisor[i], factor);
    }
  }
  return result;
}

/** Data-capacity modules for a version, excluding function patterns. */
function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver) {
  return (
    Math.floor(numRawDataModules(ver) / 8) -
    ECC_M_CODEWORDS_PER_BLOCK[ver - 1] * ECC_M_NUM_BLOCKS[ver - 1]
  );
}

/** Smallest version whose ECC-M data capacity fits `dataLen` bytes; -1 if none. */
function chooseVersion(dataLen) {
  for (let ver = 1; ver <= 40; ver++) {
    const headerBits = 4 + (ver <= 9 ? 8 : 16);
    if (headerBits + dataLen * 8 <= numDataCodewords(ver) * 8) return ver;
  }
  return -1;
}

/** Split data codewords into ECC blocks and interleave (ISO 18004 §8.6). */
function addEccAndInterleave(data, ver) {
  const numBlocks = ECC_M_NUM_BLOCKS[ver - 1];
  const blockEccLen = ECC_M_CODEWORDS_PER_BLOCK[ver - 1];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blocks = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(
      k,
      k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1),
    );
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0); // skipped slot, filtered below
    blocks.push(dat.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(block[i]);
      }
    });
  }
  return result;
}

// ---- matrix drawing ----

function drawFinder(modules, isFunction, cx, cy, size) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) {
        setFunction(modules, isFunction, x, y, dist !== 2 && dist !== 4);
      }
    }
  }
}

function drawAlignment(modules, isFunction, cx, cy) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunction(
        modules,
        isFunction,
        cx + dx,
        cy + dy,
        Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
      );
    }
  }
}

function setFunction(modules, isFunction, x, y, dark) {
  modules[y][x] = dark;
  isFunction[y][x] = true;
}

function alignmentPositions(ver, size) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step =
    ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

/** BCH(15,5)-protected format bits for ECC M + the chosen mask. */
function formatBits(mask) {
  const data = (FORMAT_ECL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormatBits(modules, isFunction, mask, size) {
  const bits = formatBits(mask);
  const bit = (i) => ((bits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) setFunction(modules, isFunction, 8, i, bit(i));
  setFunction(modules, isFunction, 8, 7, bit(6));
  setFunction(modules, isFunction, 8, 8, bit(7));
  setFunction(modules, isFunction, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) {
    setFunction(modules, isFunction, 14 - i, 8, bit(i));
  }
  for (let i = 0; i < 8; i++) {
    setFunction(modules, isFunction, size - 1 - i, 8, bit(i));
  }
  for (let i = 8; i < 15; i++) {
    setFunction(modules, isFunction, 8, size - 15 + i, bit(i));
  }
  setFunction(modules, isFunction, 8, size - 8, true); // always-dark module
}

function drawVersionInfo(modules, isFunction, ver, size) {
  if (ver < 7) return;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(modules, isFunction, a, b, dark);
    setFunction(modules, isFunction, b, a, dark);
  }
}

function drawFunctionPatterns(modules, isFunction, ver, size) {
  for (let i = 0; i < size; i++) {
    setFunction(modules, isFunction, 6, i, i % 2 === 0);
    setFunction(modules, isFunction, i, 6, i % 2 === 0);
  }
  drawFinder(modules, isFunction, 3, 3, size);
  drawFinder(modules, isFunction, size - 4, 3, size);
  drawFinder(modules, isFunction, 3, size - 4, size);
  const align = alignmentPositions(ver, size);
  const n = align.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Skip the three corners occupied by finder patterns.
      if (
        !(
          (i === 0 && j === 0) ||
          (i === 0 && j === n - 1) ||
          (i === n - 1 && j === 0)
        )
      ) {
        drawAlignment(modules, isFunction, align[i], align[j]);
      }
    }
  }
  drawFormatBits(modules, isFunction, 0, size); // reserve; redrawn per mask
  drawVersionInfo(modules, isFunction, ver, size);
}

/** Zigzag placement of all interleaved codewords (ISO 18004 §8.7.3). */
function drawCodewords(modules, isFunction, data, size) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < data.length * 8) {
          modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(modules, isFunction, mask, size) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && maskBit(mask, x, y)) {
        modules[y][x] = !modules[y][x];
      }
    }
  }
}

// ---- mask-selection penalty (ISO 18004 §8.8.2, run-history N3 method) ----

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function finderPenaltyCountPatterns(runHistory) {
  const n = runHistory[1];
  const core =
    n > 0 &&
    runHistory[2] === n &&
    runHistory[3] === n * 3 &&
    runHistory[4] === n &&
    runHistory[5] === n;
  return (
    (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
    (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
  );
}

// The all-zero history marks "nothing pushed yet": the first push absorbs the
// implicit light border outside the symbol.
function finderPenaltyAddHistory(currentRunLength, runHistory, size) {
  if (runHistory[0] === 0) currentRunLength += size;
  runHistory.pop();
  runHistory.unshift(currentRunLength);
}

function finderPenaltyTerminateAndCount(
  currentRunColor,
  currentRunLength,
  runHistory,
  size,
) {
  if (currentRunColor) {
    finderPenaltyAddHistory(currentRunLength, runHistory, size);
    currentRunLength = 0;
  }
  currentRunLength += size; // trailing light border
  finderPenaltyAddHistory(currentRunLength, runHistory, size);
  return finderPenaltyCountPatterns(runHistory);
}

function getPenaltyScore(modules, size) {
  let result = 0;
  // Rows: adjacent same-color runs + finder-like patterns.
  for (let y = 0; y < size; y++) {
    let runColor = false;
    let runX = 0;
    const runHistory = [0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < size; x++) {
      if (modules[y][x] === runColor) {
        runX++;
        if (runX === 5) result += PENALTY_N1;
        else if (runX > 5) result++;
      } else {
        finderPenaltyAddHistory(runX, runHistory, size);
        if (!runColor) {
          result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
        }
        runColor = modules[y][x];
        runX = 1;
      }
    }
    result +=
      finderPenaltyTerminateAndCount(runColor, runX, runHistory, size) *
      PENALTY_N3;
  }
  // Columns: same.
  for (let x = 0; x < size; x++) {
    let runColor = false;
    let runY = 0;
    const runHistory = [0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < size; y++) {
      if (modules[y][x] === runColor) {
        runY++;
        if (runY === 5) result += PENALTY_N1;
        else if (runY > 5) result++;
      } else {
        finderPenaltyAddHistory(runY, runHistory, size);
        if (!runColor) {
          result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
        }
        runColor = modules[y][x];
        runY = 1;
      }
    }
    result +=
      finderPenaltyTerminateAndCount(runColor, runY, runHistory, size) *
      PENALTY_N3;
  }
  // 2x2 blocks of the same color.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (
        c === modules[y][x + 1] &&
        c === modules[y + 1][x] &&
        c === modules[y + 1][x + 1]
      ) {
        result += PENALTY_N2;
      }
    }
  }
  // Dark-module balance.
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;
  return result;
}

// ---- public API ----

/**
 * Encode text (UTF-8, byte mode, ECC M) into a QR symbol.
 * Returns `{ version, size, mask, modules }` (modules[y][x] === true → dark)
 * or `null` when the text exceeds version 40's ECC-M capacity.
 */
function encodeQr(text) {
  const data = Array.from(Buffer.from(String(text ?? ""), "utf8"));
  const ver = chooseVersion(data.length);
  if (ver < 0) return null;
  const size = ver * 4 + 17;

  // Bit stream: mode 0100, char count (8/16 bits), data, terminator, pads.
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(4, 4);
  pushBits(data.length, ver <= 9 ? 8 : 16);
  for (const b of data) pushBits(b, 8);
  const capacityBits = numDataCodewords(ver) * 8;
  pushBits(0, Math.min(4, capacityBits - bits.length));
  if (bits.length % 8 !== 0) pushBits(0, 8 - (bits.length % 8));
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) {
    pushBits(pad, 8);
  }
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }

  const allCodewords = addEccAndInterleave(codewords, ver);
  const modules = Array.from({ length: size }, () =>
    new Array(size).fill(false),
  );
  const isFunction = Array.from({ length: size }, () =>
    new Array(size).fill(false),
  );
  drawFunctionPatterns(modules, isFunction, ver, size);
  drawCodewords(modules, isFunction, allCodewords, size);

  // Pick the mask with the lowest penalty score.
  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, isFunction, mask, size);
    drawFormatBits(modules, isFunction, mask, size);
    const score = getPenaltyScore(modules, size);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    applyMask(modules, isFunction, mask, size); // undo (XOR is involutory)
  }
  applyMask(modules, isFunction, bestMask, size);
  drawFormatBits(modules, isFunction, bestMask, size);

  return { version: ver, size, mask: bestMask, modules };
}

/**
 * Deterministic SVG for a webview: one path of unit squares, `border` quiet
 * modules, viewBox-scaled (crisp at any CSS size). Colors are parameters so
 * the host can honor light/dark themes.
 */
function qrToSvg(qr, { border = 4, light = "#ffffff", dark = "#000000" } = {}) {
  if (!qr || !qr.modules) return null;
  const dim = qr.size + border * 2;
  const parts = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) {
        parts.push(`M${x + border},${y + border}h1v1h-1z`);
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}"` +
    ` shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
    `<path d="${parts.join("")}" fill="${dark}"/></svg>`
  );
}

/** Compact fixture form: one hex string per row, little bit = leftmost module. */
function qrToRowHex(qr) {
  if (!qr || !qr.modules) return null;
  return qr.modules.map((row) => {
    let hex = "";
    for (let i = 0; i < row.length; i += 4) {
      let nibble = 0;
      for (let j = 0; j < 4; j++) {
        nibble = (nibble << 1) | (row[i + j] ? 1 : 0);
      }
      hex += nibble.toString(16);
    }
    return hex;
  });
}

module.exports = { encodeQr, qrToSvg, qrToRowHex };
