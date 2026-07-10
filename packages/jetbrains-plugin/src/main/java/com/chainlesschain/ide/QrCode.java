package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Self-contained QR code encoder — byte mode, error-correction level M,
 * automatic version 1–40 (ISO/IEC 18004). No dependencies (the plugin ships
 * no QR library), used to render the Remote Control pairing URI in-IDE.
 * JS twin: packages/vscode-extension/src/qr-code.js — keep the two
 * byte-identical (shared fixtures in QrCodeTest / vscode-ext-qr-code.test.js).
 *
 * SDK-free and Swing-free: glue paints {@link #modules} into an image.
 */
public final class QrCode {

    /** ECC level M tables, versions 1..40 (ISO 18004 table 13). */
    private static final int[] ECC_M_CODEWORDS_PER_BLOCK = {
        10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
        26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
        28, 28,
    };
    private static final int[] ECC_M_NUM_BLOCKS = {
        1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17,
        18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
    };
    private static final int FORMAT_ECL_M_BITS = 0; // L=1, M=0, Q=3, H=2

    private static final int PENALTY_N1 = 3;
    private static final int PENALTY_N2 = 3;
    private static final int PENALTY_N3 = 40;
    private static final int PENALTY_N4 = 10;

    public final int version;
    public final int size;
    public final int mask;
    /** modules[y][x] == true → dark. */
    public final boolean[][] modules;

    private QrCode(int version, int size, int mask, boolean[][] modules) {
        this.version = version;
        this.size = size;
        this.mask = mask;
        this.modules = modules;
    }

    /**
     * Encode text (UTF-8, byte mode, ECC M). Null when the text exceeds
     * version 40's ECC-M capacity.
     */
    public static QrCode encode(String text) {
        byte[] raw = String.valueOf(text == null ? "" : text)
                .getBytes(StandardCharsets.UTF_8);
        int[] data = new int[raw.length];
        for (int i = 0; i < raw.length; i++) data[i] = raw[i] & 0xff;
        int ver = chooseVersion(data.length);
        if (ver < 0) return null;
        int size = ver * 4 + 17;

        // Bit stream: mode 0100, char count (8/16 bits), data, terminator, pads.
        List<Integer> bits = new ArrayList<Integer>();
        pushBits(bits, 4, 4);
        pushBits(bits, data.length, ver <= 9 ? 8 : 16);
        for (int b : data) pushBits(bits, b, 8);
        int capacityBits = numDataCodewords(ver) * 8;
        pushBits(bits, 0, Math.min(4, capacityBits - bits.size()));
        if (bits.size() % 8 != 0) pushBits(bits, 0, 8 - (bits.size() % 8));
        for (int pad = 0xec; bits.size() < capacityBits; pad ^= 0xec ^ 0x11) {
            pushBits(bits, pad, 8);
        }
        int[] codewords = new int[bits.size() / 8];
        for (int i = 0; i < bits.size(); i++) {
            codewords[i >>> 3] = (codewords[i >>> 3] << 1) | bits.get(i);
        }

        int[] allCodewords = addEccAndInterleave(codewords, ver);
        boolean[][] modules = new boolean[size][size];
        boolean[][] isFunction = new boolean[size][size];
        drawFunctionPatterns(modules, isFunction, ver, size);
        drawCodewords(modules, isFunction, allCodewords, size);

        int bestMask = 0;
        long bestScore = Long.MAX_VALUE;
        for (int mask = 0; mask < 8; mask++) {
            applyMask(modules, isFunction, mask, size);
            drawFormatBits(modules, isFunction, mask, size);
            long score = getPenaltyScore(modules, size);
            if (score < bestScore) {
                bestScore = score;
                bestMask = mask;
            }
            applyMask(modules, isFunction, mask, size); // undo (XOR involutory)
        }
        applyMask(modules, isFunction, bestMask, size);
        drawFormatBits(modules, isFunction, bestMask, size);
        return new QrCode(ver, size, bestMask, modules);
    }

    /** Compact fixture form: one hex string per row, first bit = leftmost module. */
    public List<String> toRowHex() {
        List<String> out = new ArrayList<String>(size);
        for (int y = 0; y < size; y++) {
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < size; i += 4) {
                int nibble = 0;
                for (int j = 0; j < 4; j++) {
                    boolean dark = i + j < size && modules[y][i + j];
                    nibble = (nibble << 1) | (dark ? 1 : 0);
                }
                hex.append(Integer.toHexString(nibble));
            }
            out.add(hex.toString());
        }
        return out;
    }

    // ---- encoding internals (mirror the JS twin exactly) ----

    private static void pushBits(List<Integer> bits, int val, int len) {
        for (int i = len - 1; i >= 0; i--) bits.add((val >>> i) & 1);
    }

    private static int gfMul(int x, int y) {
        int z = 0;
        for (int i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >>> 7) * 0x11d);
            z ^= ((y >>> i) & 1) * x;
        }
        return z & 0xff;
    }

    private static int[] rsDivisor(int degree) {
        int[] result = new int[degree];
        result[degree - 1] = 1;
        int root = 1;
        for (int i = 0; i < degree; i++) {
            for (int j = 0; j < degree; j++) {
                result[j] = gfMul(result[j], root);
                if (j + 1 < degree) result[j] ^= result[j + 1];
            }
            root = gfMul(root, 0x02);
        }
        return result;
    }

    private static int[] rsRemainder(int[] data, int[] divisor) {
        int[] result = new int[divisor.length];
        for (int b : data) {
            int factor = b ^ result[0];
            System.arraycopy(result, 1, result, 0, result.length - 1);
            result[result.length - 1] = 0;
            for (int i = 0; i < divisor.length; i++) {
                result[i] ^= gfMul(divisor[i], factor);
            }
        }
        return result;
    }

    private static int numRawDataModules(int ver) {
        int result = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            int numAlign = ver / 7 + 2;
            result -= (25 * numAlign - 10) * numAlign - 55;
            if (ver >= 7) result -= 36;
        }
        return result;
    }

    private static int numDataCodewords(int ver) {
        return numRawDataModules(ver) / 8
                - ECC_M_CODEWORDS_PER_BLOCK[ver - 1] * ECC_M_NUM_BLOCKS[ver - 1];
    }

    private static int chooseVersion(int dataLen) {
        for (int ver = 1; ver <= 40; ver++) {
            int headerBits = 4 + (ver <= 9 ? 8 : 16);
            if (headerBits + dataLen * 8 <= numDataCodewords(ver) * 8) return ver;
        }
        return -1;
    }

    private static int[] addEccAndInterleave(int[] data, int ver) {
        int numBlocks = ECC_M_NUM_BLOCKS[ver - 1];
        int blockEccLen = ECC_M_CODEWORDS_PER_BLOCK[ver - 1];
        int rawCodewords = numRawDataModules(ver) / 8;
        int numShortBlocks = numBlocks - (rawCodewords % numBlocks);
        int shortBlockLen = rawCodewords / numBlocks;
        int[][] blocks = new int[numBlocks][];
        int[] divisor = rsDivisor(blockEccLen);
        int k = 0;
        for (int i = 0; i < numBlocks; i++) {
            int datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
            int[] dat = new int[datLen];
            System.arraycopy(data, k, dat, 0, datLen);
            k += datLen;
            int[] ecc = rsRemainder(dat, divisor);
            int[] block = new int[shortBlockLen + 1]; // short blocks: index datLen unused slot
            System.arraycopy(dat, 0, block, 0, datLen);
            System.arraycopy(ecc, 0, block,
                    (i < numShortBlocks ? datLen + 1 : datLen), blockEccLen);
            blocks[i] = block;
        }
        int[] result = new int[rawCodewords];
        int idx = 0;
        for (int i = 0; i < blocks[0].length; i++) {
            for (int j = 0; j < numBlocks; j++) {
                if (i != shortBlockLen - blockEccLen || j >= numShortBlocks) {
                    result[idx++] = blocks[j][i];
                }
            }
        }
        return result;
    }

    // ---- matrix drawing ----

    private static void setFunction(boolean[][] modules, boolean[][] isFunction,
            int x, int y, boolean dark) {
        modules[y][x] = dark;
        isFunction[y][x] = true;
    }

    private static void drawFinder(boolean[][] modules, boolean[][] isFunction,
            int cx, int cy, int size) {
        for (int dy = -4; dy <= 4; dy++) {
            for (int dx = -4; dx <= 4; dx++) {
                int dist = Math.max(Math.abs(dx), Math.abs(dy));
                int x = cx + dx;
                int y = cy + dy;
                if (x >= 0 && x < size && y >= 0 && y < size) {
                    setFunction(modules, isFunction, x, y, dist != 2 && dist != 4);
                }
            }
        }
    }

    private static void drawAlignment(boolean[][] modules, boolean[][] isFunction,
            int cx, int cy) {
        for (int dy = -2; dy <= 2; dy++) {
            for (int dx = -2; dx <= 2; dx++) {
                setFunction(modules, isFunction, cx + dx, cy + dy,
                        Math.max(Math.abs(dx), Math.abs(dy)) != 1);
            }
        }
    }

    private static int[] alignmentPositions(int ver, int size) {
        if (ver == 1) return new int[0];
        int numAlign = ver / 7 + 2;
        int step = ver == 32 ? 26
                : (int) Math.ceil((ver * 4 + 4) / (double) (numAlign * 2 - 2)) * 2;
        int[] result = new int[numAlign];
        result[0] = 6;
        int pos = size - 7;
        for (int i = numAlign - 1; i >= 1; i--, pos -= step) result[i] = pos;
        return result;
    }

    private static int formatBits(int mask) {
        int data = (FORMAT_ECL_M_BITS << 3) | mask;
        int rem = data;
        for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        return ((data << 10) | rem) ^ 0x5412;
    }

    private static void drawFormatBits(boolean[][] modules, boolean[][] isFunction,
            int mask, int size) {
        int bits = formatBits(mask);
        for (int i = 0; i <= 5; i++) {
            setFunction(modules, isFunction, 8, i, ((bits >>> i) & 1) != 0);
        }
        setFunction(modules, isFunction, 8, 7, ((bits >>> 6) & 1) != 0);
        setFunction(modules, isFunction, 8, 8, ((bits >>> 7) & 1) != 0);
        setFunction(modules, isFunction, 7, 8, ((bits >>> 8) & 1) != 0);
        for (int i = 9; i < 15; i++) {
            setFunction(modules, isFunction, 14 - i, 8, ((bits >>> i) & 1) != 0);
        }
        for (int i = 0; i < 8; i++) {
            setFunction(modules, isFunction, size - 1 - i, 8, ((bits >>> i) & 1) != 0);
        }
        for (int i = 8; i < 15; i++) {
            setFunction(modules, isFunction, 8, size - 15 + i, ((bits >>> i) & 1) != 0);
        }
        setFunction(modules, isFunction, 8, size - 8, true); // always-dark module
    }

    private static void drawVersionInfo(boolean[][] modules, boolean[][] isFunction,
            int ver, int size) {
        if (ver < 7) return;
        int rem = ver;
        for (int i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        int bits = (ver << 12) | rem;
        for (int i = 0; i < 18; i++) {
            boolean dark = ((bits >>> i) & 1) != 0;
            int a = size - 11 + i % 3;
            int b = i / 3;
            setFunction(modules, isFunction, a, b, dark);
            setFunction(modules, isFunction, b, a, dark);
        }
    }

    private static void drawFunctionPatterns(boolean[][] modules,
            boolean[][] isFunction, int ver, int size) {
        for (int i = 0; i < size; i++) {
            setFunction(modules, isFunction, 6, i, i % 2 == 0);
            setFunction(modules, isFunction, i, 6, i % 2 == 0);
        }
        drawFinder(modules, isFunction, 3, 3, size);
        drawFinder(modules, isFunction, size - 4, 3, size);
        drawFinder(modules, isFunction, 3, size - 4, size);
        int[] align = alignmentPositions(ver, size);
        int n = align.length;
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                boolean corner = (i == 0 && j == 0) || (i == 0 && j == n - 1)
                        || (i == n - 1 && j == 0);
                if (!corner) drawAlignment(modules, isFunction, align[i], align[j]);
            }
        }
        drawFormatBits(modules, isFunction, 0, size); // reserve; redrawn per mask
        drawVersionInfo(modules, isFunction, ver, size);
    }

    private static void drawCodewords(boolean[][] modules, boolean[][] isFunction,
            int[] data, int size) {
        int i = 0;
        for (int right = size - 1; right >= 1; right -= 2) {
            if (right == 6) right = 5;
            for (int vert = 0; vert < size; vert++) {
                for (int j = 0; j < 2; j++) {
                    int x = right - j;
                    boolean upward = ((right + 1) & 2) == 0;
                    int y = upward ? size - 1 - vert : vert;
                    if (!isFunction[y][x] && i < data.length * 8) {
                        modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) != 0;
                        i++;
                    }
                }
            }
        }
    }

    private static boolean maskBit(int mask, int x, int y) {
        switch (mask) {
            case 0: return (x + y) % 2 == 0;
            case 1: return y % 2 == 0;
            case 2: return x % 3 == 0;
            case 3: return (x + y) % 3 == 0;
            case 4: return (x / 3 + y / 2) % 2 == 0;
            case 5: return (x * y) % 2 + (x * y) % 3 == 0;
            case 6: return ((x * y) % 2 + (x * y) % 3) % 2 == 0;
            default: return ((x + y) % 2 + (x * y) % 3) % 2 == 0;
        }
    }

    private static void applyMask(boolean[][] modules, boolean[][] isFunction,
            int mask, int size) {
        for (int y = 0; y < size; y++) {
            for (int x = 0; x < size; x++) {
                if (!isFunction[y][x] && maskBit(mask, x, y)) {
                    modules[y][x] = !modules[y][x];
                }
            }
        }
    }

    // ---- mask-selection penalty (ISO 18004 §8.8.2, run-history N3 method) ----

    private static int finderPenaltyCountPatterns(int[] runHistory) {
        int n = runHistory[1];
        boolean core = n > 0 && runHistory[2] == n && runHistory[3] == n * 3
                && runHistory[4] == n && runHistory[5] == n;
        return ((core && runHistory[0] >= n * 4 && runHistory[6] >= n) ? 1 : 0)
                + ((core && runHistory[6] >= n * 4 && runHistory[0] >= n) ? 1 : 0);
    }

    private static void finderPenaltyAddHistory(int currentRunLength,
            int[] runHistory, int size) {
        if (runHistory[0] == 0) currentRunLength += size; // leading light border
        System.arraycopy(runHistory, 0, runHistory, 1, runHistory.length - 1);
        runHistory[0] = currentRunLength;
    }

    private static int finderPenaltyTerminateAndCount(boolean currentRunColor,
            int currentRunLength, int[] runHistory, int size) {
        if (currentRunColor) {
            finderPenaltyAddHistory(currentRunLength, runHistory, size);
            currentRunLength = 0;
        }
        currentRunLength += size; // trailing light border
        finderPenaltyAddHistory(currentRunLength, runHistory, size);
        return finderPenaltyCountPatterns(runHistory);
    }

    private static long getPenaltyScore(boolean[][] modules, int size) {
        long result = 0;
        for (int y = 0; y < size; y++) {
            boolean runColor = false;
            int runX = 0;
            int[] runHistory = new int[7];
            for (int x = 0; x < size; x++) {
                if (modules[y][x] == runColor) {
                    runX++;
                    if (runX == 5) result += PENALTY_N1;
                    else if (runX > 5) result++;
                } else {
                    finderPenaltyAddHistory(runX, runHistory, size);
                    if (!runColor) {
                        result += finderPenaltyCountPatterns(runHistory) * (long) PENALTY_N3;
                    }
                    runColor = modules[y][x];
                    runX = 1;
                }
            }
            result += finderPenaltyTerminateAndCount(runColor, runX, runHistory, size)
                    * (long) PENALTY_N3;
        }
        for (int x = 0; x < size; x++) {
            boolean runColor = false;
            int runY = 0;
            int[] runHistory = new int[7];
            for (int y = 0; y < size; y++) {
                if (modules[y][x] == runColor) {
                    runY++;
                    if (runY == 5) result += PENALTY_N1;
                    else if (runY > 5) result++;
                } else {
                    finderPenaltyAddHistory(runY, runHistory, size);
                    if (!runColor) {
                        result += finderPenaltyCountPatterns(runHistory) * (long) PENALTY_N3;
                    }
                    runColor = modules[y][x];
                    runY = 1;
                }
            }
            result += finderPenaltyTerminateAndCount(runColor, runY, runHistory, size)
                    * (long) PENALTY_N3;
        }
        for (int y = 0; y < size - 1; y++) {
            for (int x = 0; x < size - 1; x++) {
                boolean c = modules[y][x];
                if (c == modules[y][x + 1] && c == modules[y + 1][x]
                        && c == modules[y + 1][x + 1]) {
                    result += PENALTY_N2;
                }
            }
        }
        int dark = 0;
        for (boolean[] row : modules) for (boolean cell : row) if (cell) dark++;
        int total = size * size;
        int k = (int) Math.ceil(Math.abs(dark * 20L - total * 10L) / (double) total) - 1;
        result += k * (long) PENALTY_N4;
        return result;
    }
}
