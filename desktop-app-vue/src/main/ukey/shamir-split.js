"use strict";

/**
 * Shamir Secret Sharing — M-of-N threshold scheme
 * Pure Node.js implementation using GF(256) arithmetic
 */

const crypto = require("crypto");

// GF(256) using primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const GF_PRIME = 0x11d;

/**
 * Multiply two elements in GF(256)
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function gfMul(a, b) {
  let result = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if (y & 1) {
      result ^= x;
    }
    x <<= 1;
    if (x & 0x100) {
      x ^= GF_PRIME;
    }
    y >>= 1;
  }
  return result & 0xff;
}

/**
 * Compute the multiplicative inverse in GF(256) via extended Euclidean
 * @param {number} a
 * @returns {number}
 */
function gfInv(a) {
  if (a === 0) {
    throw new Error("No inverse for 0 in GF(256)");
  }
  // Exponentiation: a^254 = a^(-1) in GF(2^8)
  let result = 1;
  let base = a;
  let exp = 254;
  while (exp > 0) {
    if (exp & 1) {
      result = gfMul(result, base);
    }
    base = gfMul(base, base);
    exp >>= 1;
  }
  return result;
}

/**
 * Evaluate a polynomial at point x in GF(256)
 * @param {number[]} coefficients - [a0, a1, ..., ak] where a0 is secret byte
 * @param {number} x
 * @returns {number}
 */
function polyEval(coefficients, x) {
  let result = 0;
  let xPow = 1;
  for (const coef of coefficients) {
    result ^= gfMul(coef, xPow);
    xPow = gfMul(xPow, x);
  }
  return result;
}

/**
 * Lagrange interpolation at x=0 in GF(256)
 * @param {{ x: number, y: number }[]} points
 * @returns {number} - the secret byte at x=0
 */
function lagrangeAt0(points) {
  let secret = 0;
  for (let i = 0; i < points.length; i++) {
    let num = points[i].y;
    let den = 1;
    for (let j = 0; j < points.length; j++) {
      if (i === j) {
        continue;
      }
      num = gfMul(num, points[j].x);
      den = gfMul(den, points[i].x ^ points[j].x);
    }
    secret ^= gfMul(num, gfInv(den));
  }
  return secret;
}

/**
 * Split a secret Buffer into N shares, requiring M to reconstruct
 * @param {Buffer} secret
 * @param {number} totalShares N
 * @param {number} threshold M
 * @returns {string[]} shares in format "index:hexData"
 */
function splitSecret(secret, totalShares, threshold) {
  if (!Buffer.isBuffer(secret)) {
    secret = Buffer.from(secret);
  }
  if (threshold < 2) {
    throw new Error("Threshold must be at least 2");
  }
  if (threshold > totalShares) {
    throw new Error("Threshold cannot exceed total shares");
  }
  if (totalShares > 255) {
    throw new Error("Total shares cannot exceed 255");
  }

  const shareData = Array.from({ length: totalShares }, () => []);

  for (const byte of secret) {
    // Random polynomial: f(0) = byte, degree = threshold-1
    const coefficients = [byte];
    for (let i = 1; i < threshold; i++) {
      coefficients.push(crypto.randomBytes(1)[0]);
    }

    for (let i = 1; i <= totalShares; i++) {
      shareData[i - 1].push(polyEval(coefficients, i));
    }
  }

  return shareData.map(
    (data, i) => `${i + 1}:${Buffer.from(data).toString("hex")}`,
  );
}

/**
 * Reconstruct a secret from at least M shares
 * @param {string[]} shares - array of "index:hexData" strings
 * @returns {Buffer}
 */
function reconstructSecret(shares) {
  if (!shares || shares.length < 2) {
    throw new Error("Need at least 2 shares");
  }

  const parsed = shares
    .filter((s) => s && typeof s === "string" && s.includes(":"))
    .map((s) => {
      const [idxStr, hex] = s.split(":");
      const idx = parseInt(idxStr, 10);
      if (isNaN(idx) || idx < 1) {
        throw new Error(`Invalid share index: ${idxStr}`);
      }
      return { idx, data: Buffer.from(hex, "hex") };
    });

  if (parsed.length < 2) {
    throw new Error("Need at least 2 valid shares");
  }

  const secretLength = parsed[0].data.length;
  const result = [];

  for (let byteIdx = 0; byteIdx < secretLength; byteIdx++) {
    const points = parsed.map((s) => ({ x: s.idx, y: s.data[byteIdx] }));
    result.push(lagrangeAt0(points));
  }

  return Buffer.from(result);
}

module.exports = { splitSecret, reconstructSecret };
