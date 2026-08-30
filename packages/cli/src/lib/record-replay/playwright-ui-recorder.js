import { createRecordedSkillDraft } from "./skill-recorder.js";
import { executionBroker } from "../process-execution-broker/index.js";
import {
  navigationAllowedByRecordedSkillPolicy,
  prepareRecordedSkillBrowserTarget,
  recordedSkillBrowserEnvironment,
  requestAllowedByRecordedSkillPolicy,
} from "./browser-target-policy.js";

/* global document, Element */

const RECORDER_CALLBACK = "__ccRecordReplayCapture";
const MAX_ACTIONS = 256;
const AUTOMATION_KINDS = new Set(["click", "type", "select"]);

function recorderUiError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "RecordedSkillUiRecorderError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function boundedString(value, label, maxLength) {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    throw recorderUiError(
      "CC_RECORD_UI_ARGUMENT_INVALID",
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
    throw recorderUiError(
      "CC_RECORD_UI_ARGUMENT_INVALID",
      "viewport must use bounded integer width and height",
    );
  }
  return Object.freeze({ width, height });
}

function safeParameterBase(selector, index) {
  const id = /#([A-Za-z][A-Za-z0-9_-]*)/u.exec(selector)?.[1];
  const named =
    /\[(?:name|data-testid|data-test|data-cc-record)=["']([^"']+)["']\]/u.exec(
      selector,
    )?.[1];
  let value = String(id || named || `field${index + 1}`)
    .replace(/[^A-Za-z0-9_]/gu, "_")
    .replace(/_+/gu, "_")
    .slice(0, 64);
  if (!/^[A-Za-z]/u.test(value)) value = `field_${value}`;
  return value || `field${index + 1}`;
}

function parameterizeCapturedActions(actions, sensitiveParameters = []) {
  if (
    !Array.isArray(sensitiveParameters) ||
    sensitiveParameters.some(
      (name) =>
        typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/u.test(name),
    )
  ) {
    throw recorderUiError(
      "CC_RECORD_UI_ARGUMENT_INVALID",
      "sensitive parameter names must be valid identifiers",
    );
  }
  const manuallySensitive = new Set(sensitiveParameters);
  const bindings = [];
  const byCapturedValue = new Map();
  const usedNames = new Set();
  for (const [index, action] of actions.entries()) {
    if (!["type", "select"].includes(action.kind) || !action.value) continue;
    const capturedValue = action.value;
    const existing = byCapturedValue.get(capturedValue);
    if (existing) {
      if (action.sensitive === true) existing.sensitive = true;
      continue;
    }
    const base = safeParameterBase(action.target, index);
    let name = base;
    let suffix = 2;
    while (usedNames.has(name)) name = `${base}_${suffix++}`;
    usedNames.add(name);
    const binding = {
      name,
      value: capturedValue,
      sensitive: action.sensitive === true || manuallySensitive.has(name),
      required: true,
    };
    bindings.push(binding);
    byCapturedValue.set(capturedValue, binding);
  }
  const unknownSensitive = [...manuallySensitive].filter(
    (name) => !bindings.some((binding) => binding.name === name),
  );
  if (unknownSensitive.length > 0) {
    throw recorderUiError(
      "CC_RECORD_UI_ARGUMENT_INVALID",
      `sensitive parameter was not captured: ${unknownSensitive[0]}`,
    );
  }
  return {
    actions: actions.map((action) => {
      const persisted = { ...action };
      delete persisted.sensitive;
      return persisted;
    }),
    parameterBindings: bindings,
  };
}

function validateCapturedAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw recorderUiError(
      "CC_RECORD_UI_EVENT_INVALID",
      "the browser recorder emitted an invalid action",
    );
  }
  const kind = String(value.kind || "");
  if (!["click", "type", "select"].includes(kind)) {
    throw recorderUiError(
      "CC_RECORD_UI_EVENT_INVALID",
      "the browser recorder emitted an unsupported action",
    );
  }
  const action = {
    kind,
    target: boundedString(value.target, "captured target", 1_024),
  };
  if (["type", "select"].includes(kind)) {
    if (typeof value.value !== "string") {
      throw recorderUiError(
        "CC_RECORD_UI_EVENT_INVALID",
        "the browser recorder emitted an invalid field value",
      );
    }
    const maxLength = kind === "type" ? 8_192 : 1_024;
    if (value.value.length > maxLength) {
      throw recorderUiError(
        "CC_RECORD_UI_EVENT_INVALID",
        "the browser recorder emitted an oversized field value",
      );
    }
    action.value = value.value;
    if (value.sensitive === true) action.sensitive = true;
  }
  return Object.freeze(action);
}

function validateAutomation(actions) {
  if (!Array.isArray(actions) || actions.length > MAX_ACTIONS) {
    throw recorderUiError(
      "CC_RECORD_UI_ARGUMENT_INVALID",
      `automation must contain at most ${MAX_ACTIONS} actions`,
    );
  }
  return actions.map((action) => {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw recorderUiError(
        "CC_RECORD_UI_ARGUMENT_INVALID",
        "automation actions must be objects",
      );
    }
    const kind = String(action.kind || "");
    if (!AUTOMATION_KINDS.has(kind)) {
      throw recorderUiError(
        "CC_RECORD_UI_ARGUMENT_INVALID",
        "automation only supports click, type, and select",
      );
    }
    const normalized = {
      kind,
      target: boundedString(action.target, "automation target", 1_024),
    };
    if (["type", "select"].includes(kind)) {
      normalized.value = boundedString(
        action.value,
        "automation value",
        kind === "type" ? 8_192 : 1_024,
      );
    }
    return normalized;
  });
}

async function installCaptureScript(page) {
  await page.evaluate((callbackName) => {
    const cssEscape = (value) => {
      if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
      return String(value).replace(
        /[^A-Za-z0-9_-]/g,
        (character) => `\\${character.codePointAt(0).toString(16)} `,
      );
    };
    const quoted = (value) =>
      String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const unique = (selector) => {
      try {
        return document.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    };
    const selectorFor = (element) => {
      if (!(element instanceof Element)) return null;
      for (const attribute of ["data-testid", "data-test", "data-cc-record"]) {
        const value = element.getAttribute(attribute);
        if (value) {
          const selector = `[${attribute}="${quoted(value)}"]`;
          if (unique(selector)) return selector;
        }
      }
      if (element.id) {
        const selector = `#${cssEscape(element.id)}`;
        if (unique(selector)) return selector;
      }
      const tag = element.tagName.toLowerCase();
      const name = element.getAttribute("name");
      if (name) {
        const selector = `${tag}[name="${quoted(name)}"]`;
        if (unique(selector)) return selector;
      }
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) {
        const selector = `${tag}[aria-label="${quoted(ariaLabel)}"]`;
        if (unique(selector)) return selector;
      }
      const segments = [];
      let current = element;
      while (
        current &&
        current !== document.documentElement &&
        segments.length < 8
      ) {
        const currentTag = current.tagName.toLowerCase();
        const siblings = current.parentElement
          ? [...current.parentElement.children].filter(
              (candidate) => candidate.tagName === current.tagName,
            )
          : [];
        const position = siblings.indexOf(current) + 1;
        segments.unshift(
          siblings.length > 1
            ? `${currentTag}:nth-of-type(${position})`
            : currentTag,
        );
        const selector = segments.join(" > ");
        if (unique(selector)) return selector;
        current = current.parentElement;
      }
      return null;
    };
    const emit = (action) => {
      const callback = globalThis[callbackName];
      if (typeof callback === "function") void callback(action);
    };
    const click = (event) => {
      const target = event.target?.closest?.(
        "button,a,[role='button'],input,select,textarea,[data-testid],[data-test],[data-cc-record]",
      );
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      if (["input", "select", "textarea"].includes(tag)) return;
      const selector = selectorFor(target);
      if (selector) emit({ kind: "click", target: selector });
    };
    const change = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const selector = selectorFor(target);
      if (!selector) return;
      const tag = target.tagName.toLowerCase();
      if (tag === "select") {
        emit({
          kind: "select",
          target: selector,
          value: String(target.value || ""),
        });
        return;
      }
      if (tag === "input" || tag === "textarea") {
        const type = String(
          target.getAttribute("type") || "text",
        ).toLowerCase();
        if (
          ["checkbox", "radio", "file", "submit", "button", "reset"].includes(
            type,
          )
        ) {
          return;
        }
        emit({
          kind: "type",
          target: selector,
          value: String(target.value || ""),
          sensitive: type === "password",
        });
      }
    };
    document.addEventListener("click", click, true);
    document.addEventListener("change", change, true);
    globalThis.__ccRecordReplayStop = () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("change", change, true);
      delete globalThis.__ccRecordReplayStop;
    };
  }, RECORDER_CALLBACK);
}

/**
 * Launch a real Chromium recorder for a self-contained HTML target. The
 * browser emits only the bounded click/type/select vocabulary and selectors
 * built from stable attributes or structural CSS; text content is never used
 * to form selectors. Captured values remain in memory until finish() replaces
 * them with parameter placeholders.
 */
export async function launchPlaywrightRecordedSkillRecorder({
  html,
  url,
  allowedOrigins = [],
  storageState,
  identity = "anonymous",
  playwright,
  headless = false,
  timeoutMs = 5_000,
  viewport = { width: 960, height: 640 },
  maxActions = MAX_ACTIONS,
} = {}) {
  const target = prepareRecordedSkillBrowserTarget({
    html,
    url,
    allowedOrigins,
    storageState,
    identity,
  });
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw recorderUiError(
      "CC_RECORD_UI_ARGUMENT_INVALID",
      "timeoutMs must be an integer between 100 and 30000",
    );
  }
  if (
    !Number.isInteger(maxActions) ||
    maxActions < 1 ||
    maxActions > MAX_ACTIONS
  ) {
    throw recorderUiError(
      "CC_RECORD_UI_ARGUMENT_INVALID",
      `maxActions must be an integer between 1 and ${MAX_ACTIONS}`,
    );
  }
  const safeViewport = boundedViewport(viewport);
  const runtime = playwright || (await import("playwright"));
  if (typeof runtime?.chromium?.launch !== "function") {
    throw recorderUiError(
      "CC_RECORD_UI_RECORDER_UNAVAILABLE",
      "Playwright Chromium is required for UI recording",
    );
  }
  const executablePath = runtime.chromium.executablePath?.();
  const browser = executablePath
    ? await executionBroker.runWithProcessContext(
        {
          origin: "record-replay:chromium-recorder",
          policy: "allow",
          allowedCommands: [executablePath],
          auditContext: { actor: "record-replay-recorder" },
        },
        () =>
          runtime.chromium.launch({
            headless: headless === true,
            executablePath,
          }),
      )
    : await runtime.chromium.launch({ headless: headless === true });
  const context = await browser.newContext({
    viewport: safeViewport,
    acceptDownloads: false,
    serviceWorkers: "block",
    storageState: target.storageState || undefined,
  });
  const capturedActions = [];
  let deniedRequestCount = 0;
  let overflowed = false;
  let closed = false;
  let finished = false;
  let page;
  try {
    await context.route("**/*", async (route) => {
      if (!requestAllowedByRecordedSkillPolicy(route.request().url(), target)) {
        deniedRequestCount += 1;
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    if (target.networkPolicy.mode === "deny") await context.setOffline(true);
    page = await context.newPage();
    await page.exposeFunction(RECORDER_CALLBACK, (rawAction) => {
      if (finished || closed) return;
      if (capturedActions.length >= maxActions) {
        overflowed = true;
        return;
      }
      capturedActions.push(validateCapturedAction(rawAction));
    });
    if (target.adapter === "self-contained-html") {
      await page.setContent(target.html, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
    } else {
      await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      if (!navigationAllowedByRecordedSkillPolicy(page.url(), target)) {
        throw recorderUiError(
          "CC_RECORD_UI_NETWORK_ATTEMPT",
          "recording target redirected outside its reviewed origin policy",
        );
      }
      page.on("domcontentloaded", () => {
        void installCaptureScript(page).catch(() => {});
      });
    }
    await installCaptureScript(page);
  } catch (cause) {
    await browser.close();
    throw recorderUiError(
      "CC_RECORD_UI_SETUP_FAILED",
      "isolated UI recorder setup failed",
      { cause },
    );
  }
  if (deniedRequestCount > 0) {
    await browser.close();
    throw recorderUiError(
      "CC_RECORD_UI_FIXTURE_NETWORKED",
      "recording target attempted access outside its reviewed network policy while loading",
      { deniedRequestCount },
    );
  }

  return Object.freeze({
    browserVersion: String(browser.version?.() || "unknown").slice(0, 128),
    adapter: target.adapter,
    targetDigest: target.targetDigest,
    fixtureDigest:
      target.adapter === "self-contained-html" ? target.targetDigest : null,
    storageStateDigest: target.storageStateDigest,
    identity: target.identity,
    networkPolicy: target.networkPolicy,
    async runAutomation(actions) {
      if (finished || closed) {
        throw recorderUiError(
          "CC_RECORD_UI_STATE_INVALID",
          "the UI recorder is no longer accepting interactions",
        );
      }
      for (const action of validateAutomation(actions)) {
        const locator = page.locator(action.target);
        if ((await locator.count()) !== 1) {
          throw recorderUiError(
            "CC_RECORD_UI_TARGET_AMBIGUOUS",
            "automation target must resolve to exactly one element",
          );
        }
        if (action.kind === "click") {
          await locator.click({ timeout: timeoutMs });
        } else if (action.kind === "type") {
          await locator.fill(action.value, { timeout: timeoutMs });
          await locator.dispatchEvent("change");
        } else {
          await locator.selectOption(action.value, { timeout: timeoutMs });
        }
        await page.waitForTimeout(0);
      }
    },
    async finish({
      name,
      description = "",
      environment = {},
      failureConditions = [],
      observations = [],
      assertions = [],
      sensitiveParameters = [],
    } = {}) {
      if (finished || closed) {
        throw recorderUiError(
          "CC_RECORD_UI_STATE_INVALID",
          "the UI recorder has already finished",
        );
      }
      finished = true;
      await page.evaluate(() => globalThis.__ccRecordReplayStop?.());
      if (overflowed) {
        throw recorderUiError(
          "CC_RECORD_UI_ACTION_LIMIT",
          `recording exceeded the ${maxActions} action limit`,
        );
      }
      if (deniedRequestCount > 0) {
        throw recorderUiError(
          "CC_RECORD_UI_NETWORK_ATTEMPT",
          "recorded interaction attempted filesystem or network access",
          { deniedRequestCount },
        );
      }
      if (!Array.isArray(observations) || !Array.isArray(assertions)) {
        throw recorderUiError(
          "CC_RECORD_UI_ARGUMENT_INVALID",
          "observations and assertions must be arrays",
        );
      }
      const normalizedObservations = observations.map((observation) => ({
        kind: "observe",
        target: boundedString(
          typeof observation === "string" ? observation : observation?.target,
          "observation target",
          1_024,
        ),
      }));
      const normalizedAssertions = assertions.map((assertion) => {
        if (
          !assertion ||
          typeof assertion !== "object" ||
          Array.isArray(assertion)
        ) {
          throw recorderUiError(
            "CC_RECORD_UI_ARGUMENT_INVALID",
            "assertions must be objects",
          );
        }
        const normalized = {
          kind: "assert",
          target: boundedString(assertion.target, "assertion target", 1_024),
        };
        if ("value" in assertion) {
          if (
            typeof assertion.value !== "string" ||
            assertion.value.length > 8_192
          ) {
            throw recorderUiError(
              "CC_RECORD_UI_ARGUMENT_INVALID",
              "assertion value must be a string no longer than 8192 characters",
            );
          }
          normalized.value = assertion.value;
        }
        return normalized;
      });
      const parameterized = parameterizeCapturedActions(
        [
          ...capturedActions,
          ...normalizedObservations,
          ...normalizedAssertions,
        ],
        sensitiveParameters,
      );
      capturedActions.splice(0, capturedActions.length);
      return createRecordedSkillDraft({
        name,
        description,
        actions: parameterized.actions,
        parameterBindings: parameterized.parameterBindings,
        environment: {
          ...environment,
          ...recordedSkillBrowserEnvironment(target),
        },
        failureConditions,
      });
    },
    summary() {
      const counts = { click: 0, type: 0, select: 0 };
      for (const action of capturedActions) counts[action.kind] += 1;
      return Object.freeze({
        schema: "chainlesschain.recorded-skill-ui-recording-summary/v1",
        closed,
        finished,
        actionCount: capturedActions.length,
        actionCounts: Object.freeze(counts),
        deniedRequestCount,
        overflowed,
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      capturedActions.splice(0, capturedActions.length);
      try {
        await context.close();
      } finally {
        await browser.close();
      }
    },
  });
}
