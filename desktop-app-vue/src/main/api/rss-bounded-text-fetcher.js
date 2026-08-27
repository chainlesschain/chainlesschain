"use strict";

const {
  RSSFetcherBoundaryError,
  safeProperty,
  safeString,
} = require("./rss-fetcher-boundaries.js");

const SUPPORTED_ENCODINGS = new Set([
  "ascii",
  "utf8",
  "utf16le",
  "ucs2",
  "latin1",
]);

function responseEncoding(headers) {
  const contentType = safeString(safeProperty(headers, "content-type", ""));
  const encodingMatch = contentType.match(
    /(?:encoding|charset)\s*=\s*["']?([^;"'\s]+)/i,
  );
  const requestedEncoding = encodingMatch
    ? encodingMatch[1].toLowerCase()
    : "utf8";
  const encodingAliases = {
    "utf-8": "utf8",
    "iso-8859-1": "latin1",
  };
  const encoding = encodingAliases[requestedEncoding] || requestedEncoding;
  return SUPPORTED_ENCODINGS.has(encoding) ? encoding : "utf8";
}

function fetchBoundedText({
  url,
  maxBytes,
  scope,
  redirectCount = 0,
  limits,
  httpClient,
  httpsClient,
  isValidUrl,
}) {
  if (!isValidUrl(url)) {
    return Promise.reject(
      new RSSFetcherBoundaryError(
        "INVALID_ARGUMENT",
        "rss_url",
        "Invalid or oversized RSS URL",
        { limit: { maxUrlBytes: limits.maxUrlBytes } },
      ),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? httpsClient : httpClient;
    const request = client.get(
      url,
      {
        headers: {
          "User-Agent": "ChainlessChain/0.20.0 (RSS Reader)",
          Accept:
            "application/rss+xml, application/xml, text/xml, application/atom+xml, text/html",
        },
        maxHeaderSize: 16 * 1024,
      },
      (response) => {
        const statusCode = Number(response.statusCode) || 0;
        const location = safeProperty(response.headers, "location", "");
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume?.();
          if (redirectCount >= limits.maxRedirects) {
            finish(
              new RSSFetcherBoundaryError(
                "OVERLOADED",
                "rss_redirects",
                "RSS redirect limit reached",
                { limit: { maxRedirects: limits.maxRedirects } },
              ),
            );
            return;
          }
          let redirectedUrl;
          try {
            redirectedUrl = new URL(location, url).href;
          } catch {
            finish(
              new RSSFetcherBoundaryError(
                "INVALID_ARGUMENT",
                "rss_redirect_url",
                "RSS response contains an invalid redirect URL",
              ),
            );
            return;
          }
          fetchBoundedText({
            url: redirectedUrl,
            maxBytes,
            scope,
            redirectCount: redirectCount + 1,
            limits,
            httpClient,
            httpsClient,
            isValidUrl,
          }).then(
            (value) => finish(null, value),
            (error) => finish(error),
          );
          return;
        }
        if (statusCode !== 200) {
          response.resume?.();
          finish(new Error(`HTTP ${statusCode}`));
          return;
        }

        const declaredLength = Number.parseInt(
          safeProperty(response.headers, "content-length", "0"),
          10,
        );
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          response.resume?.();
          finish(
            new RSSFetcherBoundaryError(
              "OVERLOADED",
              scope,
              "RSS response exceeds the byte limit",
              { limit: { maxBytes } },
            ),
          );
          return;
        }

        const chunks = [];
        let receivedBytes = 0;
        response.on("error", (error) => finish(error));
        response.on("data", (chunk) => {
          if (settled) {
            return;
          }
          const buffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk, "utf8");
          receivedBytes += buffer.length;
          if (receivedBytes > maxBytes) {
            const error = new RSSFetcherBoundaryError(
              "OVERLOADED",
              scope,
              "RSS response exceeds the byte limit",
              { limit: { maxBytes } },
            );
            response.destroy?.(error);
            finish(error);
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          finish(
            null,
            Buffer.concat(chunks, receivedBytes).toString(
              responseEncoding(response.headers),
            ),
          );
        });
      },
    );
    request.setTimeout?.(limits.requestTimeoutMs, () => {
      const error = new RSSFetcherBoundaryError(
        "CANCELED",
        "rss_request_timeout",
        "RSS request timed out",
        { limit: { requestTimeoutMs: limits.requestTimeoutMs } },
      );
      request.destroy?.(error);
      finish(error);
    });
    request.on("error", (error) => finish(error));
  });
}

module.exports = { fetchBoundedText };
