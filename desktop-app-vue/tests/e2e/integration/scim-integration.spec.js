/**
 * SCIM Integration Page E2E Tests
 * Verifies the SCIMIntegrationPage renders correctly with expected elements.
 */

import { test, expect } from "@playwright/test";

test.describe("SCIM Integration Page", () => {
  test("page loads with SCIM title", async ({ page }) => {
    await page.goto("http://localhost:5173/scim-integration");
    await expect(
      page.locator(".scim-integration-page .ant-page-header-heading-title, .scim-integration-page h1, .ant-page-header-heading-title")
    ).toContainText("SCIM Integration");
  });

  test("Sync Status tab is visible", async ({ page }) => {
    await page.goto("http://localhost:5173/scim-integration");
    await expect(
      page.locator('.ant-tabs-tab:has-text("Sync Status")')
    ).toBeVisible();
  });

  test("Connectors tab is accessible", async ({ page }) => {
    await page.goto("http://localhost:5173/scim-integration");
    await page.click('.ant-tabs-tab:has-text("Connectors")');
    await expect(
      page.locator('.ant-tabs-tab-active:has-text("Connectors")')
    ).toBeVisible();
  });

  test("Provisioned Users tab is accessible", async ({ page }) => {
    await page.goto("http://localhost:5173/scim-integration");
    await page.click('.ant-tabs-tab:has-text("Provisioned Users")');
    await expect(
      page.locator('.ant-tabs-tab-active:has-text("Provisioned Users")')
    ).toBeVisible();
  });
});
