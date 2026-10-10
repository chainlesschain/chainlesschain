// This function is also embedded in the isolated browser decoder worker.
// Container admission is deliberately separate from actual codec decoding.
function inspectImageBudget(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (message) => {
    throw new Error(message);
  };
  const need = (at, size) => {
    if (at < 0 || size < 0 || at + size > bytes.length)
      fail("Truncated image container");
  };
  const text = (at, size) => {
    need(at, size);
    return String.fromCharCode(...bytes.subarray(at, at + size));
  };
  const u16 = (at) => {
    need(at, 2);
    return view.getUint16(at, true);
  };
  const u24 = (at) => {
    need(at, 3);
    return bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
  };
  const u32 = (at, little = false) => {
    need(at, 4);
    return view.getUint32(at, little);
  };
  const pixels = (width, height) => {
    if (!width || !height || width * height > 40_000_000)
      fail("Image dimensions exceed 40 megapixels or are invalid");
    return width * height;
  };
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    fail("Image must be nonempty and at most 20 MiB");
  let width = 0,
    height = 0,
    frames = 0,
    format;
  let extraCanvases = 0;
  const frame = (w = width, h = height) => {
    pixels(w, h);
    frames++;
    if (frames > 200 || pixels(width, height) * frames > 40_000_000)
      fail("Animation exceeds 200 frames or 40 million decoded canvas pixels");
  };
  if (bytes.length >= 8 && u32(0) === 0x89504e47 && u32(4) === 0x0d0a1a0a) {
    format = "png";
    let at = 8,
      ended = false,
      dataSeen = false,
      declared = 0;
    let chunks = 0;
    while (at < bytes.length) {
      if (++chunks > 16384) fail("PNG exceeds the 16,384 chunk budget");
      need(at, 12);
      const size = u32(at),
        type = text(at + 4, 4),
        data = at + 8;
      need(data, size + 4);
      if (!width && (type !== "IHDR" || size !== 13))
        fail("PNG requires its IHDR first");
      // Reject damaged chunks before a tolerant browser codec can conceal them.
      let crc = 0xffffffff;
      for (let i = at + 4; i < data + size; i++) {
        crc ^= bytes[i];
        for (let bit = 0; bit < 8; bit++)
          crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if ((crc ^ 0xffffffff) >>> 0 !== u32(data + size))
        fail("PNG chunk checksum mismatch");
      if (
        type[0] === type[0].toUpperCase() &&
        !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)
      )
        fail("Unsupported PNG critical chunk");
      const fixedSizes = { gAMA: 4, cHRM: 32, sRGB: 1 };
      if (fixedSizes[type] && size !== fixedSizes[type])
        fail("Invalid PNG color metadata");
      if (
        (type === "PLTE" && (!size || size > 768 || size % 3)) ||
        (type === "tRNS" && size > 256)
      )
        fail("Invalid PNG palette metadata");
      if (type === "IHDR") {
        if (width || size !== 13) fail("Invalid PNG header");
        width = u32(data);
        height = u32(data + 4);
        pixels(width, height);
      } else if (type === "acTL") {
        if (size !== 8 || declared || dataSeen)
          fail("Invalid PNG animation control");
        declared = u32(data);
        if (
          !declared ||
          declared > 200 ||
          width * height * declared > 40_000_000
        )
          fail(
            "Animation exceeds 200 frames or 40 million decoded canvas pixels",
          );
      } else if (type === "fcTL") {
        if (size !== 26 || !declared) fail("Invalid PNG animation frame");
        const w = u32(data + 4),
          h = u32(data + 8);
        if (u32(data + 12) + w > width || u32(data + 16) + h > height)
          fail("PNG frame exceeds canvas");
        frame(w, h);
      } else if (type === "IDAT") {
        if (!dataSeen && declared && !frames) extraCanvases = 1;
        dataSeen = true;
      } else if (type === "IEND") {
        if (size !== 0 || !dataSeen || data + 4 !== bytes.length)
          fail("Invalid PNG end");
        ended = true;
      }
      at = data + size + 4;
    }
    if (!ended || (declared && frames !== declared))
      fail("Incomplete PNG image or animation");
    if (!frames) frame();
  } else if (bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(text(0, 6))) {
    format = "gif";
    width = u16(6);
    height = u16(8);
    pixels(width, height);
    let at = 13 + (bytes[10] & 128 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
    need(0, at);
    const blocks = () => {
      while (true) {
        need(at, 1);
        const size = bytes[at++];
        if (!size) return;
        need(at, size);
        at += size;
      }
    };
    let ended = false;
    while (at < bytes.length) {
      const type = bytes[at++];
      if (type === 0x3b) {
        ended = at === bytes.length;
        break;
      }
      if (type === 0x21) {
        need(at, 1);
        at++;
        blocks();
        continue;
      }
      if (type !== 0x2c) fail("Invalid GIF block");
      need(at, 9);
      const w = u16(at + 4),
        h = u16(at + 6);
      if (u16(at) + w > width || u16(at + 2) + h > height)
        fail("GIF frame exceeds canvas");
      frame(w, h);
      const packed = bytes[at + 8];
      at += 9;
      if (packed & 128) at += 3 * (1 << ((packed & 7) + 1));
      need(at, 1);
      if (bytes[at] < 2 || bytes[at] > 8) fail("Invalid GIF code size");
      at++;
      blocks();
    }
    if (!ended || !frames) fail("Incomplete GIF image");
  } else if (
    bytes.length >= 12 &&
    text(0, 4) === "RIFF" &&
    text(8, 4) === "WEBP"
  ) {
    format = "webp";
    if (u32(4, true) + 8 !== bytes.length)
      fail("Invalid WebP container length");
    const codedSize = (type, data, size) => {
      if (type === "VP8 ") {
        if (size < 10 || text(data + 3, 3) !== "\x9d\x01\x2a")
          fail("Invalid WebP lossy frame");
        return [u16(data + 6) & 16383, u16(data + 8) & 16383];
      }
      if (type !== "VP8L" || size < 5 || bytes[data] !== 47)
        fail("Invalid WebP lossless frame");
      const bits = u32(data + 1, true);
      return [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1];
    };
    let at = 12,
      animated = false,
      imageSeen = false;
    while (at < bytes.length) {
      need(at, 8);
      const type = text(at, 4),
        size = u32(at + 4, true),
        data = at + 8;
      need(data, size + (size % 2));
      if (type === "VP8X") {
        if (at !== 12 || size !== 10) fail("Invalid WebP extended header");
        width = u24(data + 4) + 1;
        height = u24(data + 7) + 1;
        animated = !!(bytes[data] & 2);
        pixels(width, height);
      } else if (type === "ANMF") {
        if (!animated || size < 24) fail("Invalid WebP animation frame");
        const w = u24(data + 6) + 1,
          h = u24(data + 9) + 1;
        if (u24(data) * 2 + w > width || u24(data + 3) * 2 + h > height)
          fail("WebP frame exceeds canvas");
        frame(w, h);
        let inner = data + 16,
          coded = false;
        while (inner < data + size) {
          if (inner + 8 > data + size) fail("Truncated WebP frame chunk");
          const kind = text(inner, 4),
            length = u32(inner + 4, true);
          if (inner + 8 + length + (length % 2) > data + size)
            fail("Truncated WebP frame payload");
          if (kind === "VP8 " || kind === "VP8L") {
            if (coded) fail("Duplicate WebP frame payload");
            const [cw, ch] = codedSize(kind, inner + 8, length);
            if (cw !== w || ch !== h)
              fail("WebP coded frame dimensions disagree");
            coded = true;
          } else if (kind !== "ALPH" || coded)
            fail("Invalid WebP frame payload");
          inner += 8 + length + (length % 2);
        }
        if (!coded) fail("Missing WebP frame payload");
      } else if (type === "VP8 " || type === "VP8L") {
        if (imageSeen || animated) fail("Unexpected WebP image chunk");
        imageSeen = true;
        const [w, h] = codedSize(type, data, size);
        if (width && (width !== w || height !== h))
          fail("WebP dimensions disagree");
        width = w;
        height = h;
        frame();
      }
      at = data + size + (size % 2);
    }
    if (!frames || (!animated && !imageSeen)) fail("Incomplete WebP image");
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    format = "jpeg";
    let at = 2,
      ended = false,
      scan = false;
    while (at < bytes.length) {
      if (bytes[at++] !== 255) {
        if (scan) continue;
        fail("Invalid JPEG marker");
      }
      while (bytes[at] === 255) at++;
      need(at, 1);
      const marker = bytes[at++];
      if (marker === 0 && scan) continue;
      if (marker >= 208 && marker <= 215 && scan) continue;
      if (marker === 217) {
        ended = at === bytes.length;
        break;
      }
      if (marker === 1) continue;
      need(at, 2);
      const size = view.getUint16(at);
      if (size < 2) fail("Invalid JPEG segment");
      need(at, size);
      if ([192, 193, 194].includes(marker)) {
        if (size < 8 || width) fail("Invalid JPEG frame");
        height = view.getUint16(at + 3);
        width = view.getUint16(at + 5);
        pixels(width, height);
      }
      if (marker === 218) scan = true;
      at += size;
    }
    if (!ended || !scan || !width) fail("Incomplete or unsupported JPEG image");
    frame();
  } else
    fail("Unsupported or malformed image header; use PNG, JPEG, GIF or WebP");
  if (
    frames + extraCanvases > 200 ||
    false
  )
    fail(
      "Animation and fallback exceed 200 frames or 40 million decoded canvas pixels",
    );
  return {
    format,
    width,
    height,
    frames,
    extraCanvases,
    decodedPixels: width * height * (frames + extraCanvases),
  };
}

module.exports = { inspectImageBudget };
