"use strict";
/* global DataTransfer, ClipboardEvent, DragEvent */

/** Fixed, bounded samples for the authenticated host journey. Dispatch browser
 * events so paste/drop use the same FileReader and validation as user input.
 * No caller-supplied bytes, paths, MIME types or script are accepted. */
function dispatchHostImageFixture(input, fixture, via) {
  if (!["paste", "drop"].includes(via))
    throw new Error("Unsupported host image event");
  const samples = {
    png: [
      "image/png",
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgKfjwHwAEZAJsF63ZDAAAAABJRU5ErkJggg==",
    ],
    gif: [
      "image/gif",
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    ],
    malformed: ["image/png", "bm90LWFuLWltYWdl"],
    unsupported: ["image/svg+xml", "PHN2Zy8+"],
  };
  let bytes;
  let mime;
  if (fixture === "oversized") {
    bytes = new Uint8Array(20 * 1024 * 1024 + 1);
    mime = "image/png";
  } else {
    if (!Object.hasOwn(samples, fixture))
      throw new Error("Unsupported host image fixture");
    [mime] = samples[fixture];
    bytes = Uint8Array.from(atob(samples[fixture][1]), (ch) =>
      ch.charCodeAt(0),
    );
  }
  const data = new DataTransfer();
  data.items.add(new File([bytes], "host-image-" + fixture, { type: mime }));
  const event =
    via === "paste"
      ? new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      : new DragEvent("drop", {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        });
  input.dispatchEvent(event);
  if (!event.defaultPrevented)
    throw new Error("Image event was not handled by the composer");
  return { dispatched: via, fixture };
}

/** Only hashes and rendered image dimensions leave the authenticated relay;
 * attachment contents never enter journey logs or evidence. */
async function snapshotHostImageAttachments(attach) {
  return Promise.all(
    [...attach.querySelectorAll(".chip img")].map(async (img) => {
      const match =
        /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
          img.src,
        );
      if (!match || match[2].length > 28 * 1024 * 1024)
        throw new Error("Invalid rendered image source");
      const bytes = Uint8Array.from(atob(match[2]), (ch) => ch.charCodeAt(0));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return {
        sha256: [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join(""),
        mime: match[1],
        bytes: bytes.length,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        loaded: img.complete && img.naturalWidth > 0 && img.naturalHeight > 0,
      };
    }),
  );
}

module.exports = { dispatchHostImageFixture, snapshotHostImageAttachments };
