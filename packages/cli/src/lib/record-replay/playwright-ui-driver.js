import { createHash } from "node:crypto";

const ACTION_CAPABILITIES = Object.freeze({
  observe: "ui.observe",
  assert: "ui.observe",
  click: "ui.interact",
  type: "ui.interact",
  select: "ui.interact",
});
const DRIVER_CAPABILITIES = Object.freeze([
  "ui.interact",
  "ui.observe",
]);
const DENIED_SCHEMES = new Set(["file:", "http:", "https:", "ws:", "wss:"]);

function driverError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "RecordedSkillUiDriverError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function digest(value, domain) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(bytes)
    .digest("hex")}`;
}

function boundedString(value, label, maxLength) {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    throw driverError(
      "CC_REPLAY_UI_ARGUMENT_INVALID",
      `${label} must be a non-empty string no longer than ${maxLength} characters`,
    );
  }
  return value;
}

function boundedViewport(viewport) {
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  if (
    !Number.isInteger(width) ||
    width < 320 ||
    width > 3_840 ||
    !Number.isInteger(height) ||
    height < 240 ||
    height > 2_160
  ) {
    throw driverError(
      "CC_REPLAY_UI_ARGUMENT_INVALID",
      "viewport must use bounded integer width and height",
    );
  }
  return Object.freeze({ width, height });
}

function requestMetadata(request) {
  let scheme = "invalid:";
  try {
    scheme = new URL(request.url()).protocol;
  } catch {
    // The raw URL is deliberately not retained in evidence or errors.
  }
  return Object.freeze({
    scheme,
    method: String(request.method?.() || "GET").toUpperCase().slice(0, 16),
  });
}

async function locatorState(locator, timeoutMs, { allowDetached = false } = {}) {
  const count = await locator.count();
  if (count !== 1) {
    if (allowDetached && count === 0) {
      return Object.freeze({ detached: true });
    }
    throw driverError(
      "CC_REPLAY_UI_TARGET_AMBIGUOUS",
      "recorded UI selector must resolve to exactly one element",
      { matchCount: count },
    );
  }
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const [tagName, role, inputType, visible] = await Promise.all([
    locator.evaluate((element) => element.tagName.toLowerCase()),
    locator.getAttribute("role"),
    locator.getAttribute("type"),
    locator.isVisible(),
  ]);
  let semanticValue;
  if (["input", "select", "textarea"].includes(tagName)) {
    semanticValue = await locator.inputValue();
  } else {
    semanticValue = String((await locator.textContent()) || "").trim();
  }
  return Object.freeze({
    detached: false,
    tagName,
    role: role || null,
    inputType: inputType || null,
    visible,
    semanticValueDigest: digest(
      semanticValue,
      "cc.record-replay.ui-semantic-value/v1",
    ),
  });
}

async function assertAction(locator, action, timeoutMs) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  if (!("value" in action)) return;
  const tagName = await locator.evaluate((element) =>
    element.tagName.toLowerCase(),
  );
  const actual = ["input", "select", "textarea"].includes(tagName)
    ? await locator.inputValue()
    : String((await locator.textContent()) || "").trim();
  if (String(actual) !== String(action.value)) {
    throw driverError(
      "CC_REPLAY_UI_ASSERTION_FAILED",
      "recorded UI assertion did not match the reviewed value",
    );
  }
}

/**
 * Launch an ephemeral Chromium context that can execute the low-risk
 * Record & Replay action vocabulary. The context owns its page and denies all
 * filesystem and network requests. Returned evidence contains hashes and
 * structural metadata only; selector, typed value, page text, and URLs are
 * never copied into the replay report.
 */
export async function launchPlaywrightRecordedSkillDriver({
  html,
  playwright,
  timeoutMs = 5_000,
  settleMs = 25,
  viewport = { width: 960, height: 640 },
} = {}) {
  const fixtureHtml = boundedString(html, "fixture html", 1_000_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw driverError(
      "CC_REPLAY_UI_ARGUMENT_INVALID",
      "timeoutMs must be an integer between 100 and 30000",
    );
  }
  if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 1_000) {
    throw driverError(
      "CC_REPLAY_UI_ARGUMENT_INVALID",
      "settleMs must be an integer between 0 and 1000",
    );
  }
  const safeViewport = boundedViewport(viewport);
  const runtime = playwright || (await import("playwright"));
  if (typeof runtime?.chromium?.launch !== "function") {
    throw driverError(
      "CC_REPLAY_UI_DRIVER_UNAVAILABLE",
      "Playwright Chromium is required for recorded UI replay",
    );
  }

  const browser = await runtime.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: safeViewport,
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  const deniedRequests = [];
  const receipts = [];
  let page;
  try {
    await context.route("**/*", async (route) => {
      const metadata = requestMetadata(route.request());
      if (DENIED_SCHEMES.has(metadata.scheme)) {
        deniedRequests.push(metadata);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    await context.setOffline(true);
    page = await context.newPage();
    await page.setContent(fixtureHtml, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
  } catch {
    await browser.close();
    throw driverError(
      "CC_REPLAY_UI_DRIVER_SETUP_FAILED",
      "isolated recorded UI driver setup failed",
    );
  }
  if (deniedRequests.length) {
    await browser.close();
    throw driverError(
      "CC_REPLAY_UI_FIXTURE_NETWORKED",
      "recorded UI fixture attempted filesystem or network access while loading",
      { deniedRequestCount: deniedRequests.length },
    );
  }

  const executor = Object.freeze({
    capabilities: DRIVER_CAPABILITIES,
    async execute(action, { isolation, capability } = {}) {
      if (isolation?.sandboxed !== true || isolation?.network !== "deny") {
        throw driverError(
          "CC_REPLAY_UI_ISOLATION_REQUIRED",
          "UI replay driver requires an ephemeral network-denied isolation",
        );
      }
      const kind = String(action?.kind || "");
      const expectedCapability = ACTION_CAPABILITIES[kind];
      if (!expectedCapability || capability !== expectedCapability) {
        throw driverError(
          "CC_REPLAY_UI_CAPABILITY_MISMATCH",
          "recorded UI action is outside the granted driver capability",
        );
      }
      try {
        const selector = boundedString(action.target, "action target", 1_024);
        const locator = page.locator(selector);
        const deniedBefore = deniedRequests.length;
        const before = await locatorState(locator, timeoutMs);

        if (kind === "click") {
          await locator.click({ timeout: timeoutMs });
        } else if (kind === "type") {
          const value = boundedString(action.value, "typed value", 8_192);
          await locator.fill(value, { timeout: timeoutMs });
        } else if (kind === "select") {
          const value = boundedString(action.value, "selected value", 1_024);
          await locator.selectOption(value, { timeout: timeoutMs });
        } else if (kind === "assert") {
          await assertAction(locator, action, timeoutMs);
        } else {
          await locator.waitFor({ state: "visible", timeout: timeoutMs });
        }

        if (settleMs) await page.waitForTimeout(settleMs);
        const newDeniedRequests = deniedRequests.length - deniedBefore;
        if (newDeniedRequests > 0) {
          throw driverError(
            "CC_REPLAY_UI_NETWORK_ATTEMPT",
            "recorded UI action attempted filesystem or network access",
            { deniedRequestCount: newDeniedRequests },
          );
        }
        const after = await locatorState(locator, timeoutMs, {
          allowDetached: kind === "click",
        });
        const screenshot = await page.screenshot({
          animations: "disabled",
          caret: "hide",
        });
        const evidence = Object.freeze({
          schema: "chainlesschain.recorded-skill-ui-evidence/v1",
          kind,
          capability,
          targetDigest: digest(selector, "cc.record-replay.ui-target/v1"),
          beforeStateDigest: digest(
            JSON.stringify(before),
            "cc.record-replay.ui-state/v1",
          ),
          afterStateDigest: digest(
            JSON.stringify(after),
            "cc.record-replay.ui-state/v1",
          ),
          pageDigest: digest(
            await page.content(),
            "cc.record-replay.ui-page/v1",
          ),
          screenshotDigest: digest(
            screenshot,
            "cc.record-replay.ui-screenshot/v1",
          ),
          networkPolicy: "deny",
          deniedRequestCount: 0,
        });
        receipts.push(evidence);
        return Object.freeze({ ok: true, evidence });
      } catch (error) {
        if (error?.name === "RecordedSkillUiDriverError") throw error;
        throw driverError(
          "CC_REPLAY_UI_ACTION_FAILED",
          "recorded UI action failed inside the isolated driver",
        );
      }
    },
  });

  let closed = false;
  return Object.freeze({
    executor,
    browserVersion: String(browser.version?.() || "unknown").slice(0, 128),
    fixtureDigest: digest(fixtureHtml, "cc.record-replay.ui-fixture/v1"),
    summary() {
      return Object.freeze({
        schema: "chainlesschain.recorded-skill-ui-driver-summary/v1",
        closed,
        actionCount: receipts.length,
        deniedRequestCount: deniedRequests.length,
        receiptDigests: Object.freeze(
          receipts.map((receipt) =>
            digest(
              JSON.stringify(receipt),
              "cc.record-replay.ui-driver-receipt/v1",
            ),
          ),
        ),
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await context.close();
      } finally {
        await browser.close();
      }
    },
  });
}
