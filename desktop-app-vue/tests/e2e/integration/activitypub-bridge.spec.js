/**
 * ActivityPub Bridge Page E2E Tests
 * Verifies the ActivityPubBridgePage renders correctly with expected elements.
 */

import { test, expect } from "@playwright/test";

test.describe("ActivityPub Bridge Page", () => {
  test("page loads and shows title", async ({ page }) => {
    await page.goto("http://localhost:5173/activitypub-bridge");
    await expect(
      page.locator(".activitypub-bridge-page .ant-page-header-heading-title, .activitypub-bridge-page h1, .ant-page-header-heading-title")
    ).toContainText("ActivityPub Bridge");
  });

  test("Bridge Status tab is visible", async ({ page }) => {
    await page.goto("http://localhost:5173/activitypub-bridge");
    await expect(
      page.locator('.ant-tabs-tab:has-text("Bridge Status")')
    ).toBeVisible();
  });

  test("Actor Management tab is accessible", async ({ page }) => {
    await page.goto("http://localhost:5173/activitypub-bridge");
    await page.click('.ant-tabs-tab:has-text("Actor Management")');
    await expect(
      page.locator('.ant-tabs-tab-active:has-text("Actor Management")')
    ).toBeVisible();
  });

  test("User Discovery tab is accessible", async ({ page }) => {
    await page.goto("http://localhost:5173/activitypub-bridge");
    await page.click('.ant-tabs-tab:has-text("User Discovery")');
    await expect(
      page.locator('.ant-tabs-tab-active:has-text("User Discovery")')
    ).toBeVisible();
  });
});
