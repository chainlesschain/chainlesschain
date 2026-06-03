/**
 * Compliance Dashboard Page E2E Tests
 * Verifies the ComplianceDashboardPage renders correctly with expected elements.
 */

import { test, expect } from "@playwright/test";

test.describe("Compliance Dashboard Page", () => {
  test("page loads with SOC 2 title", async ({ page }) => {
    await page.goto("http://localhost:5173/compliance-dashboard");
    await expect(
      page.locator(".compliance-dashboard-page .ant-page-header-heading-title, .compliance-dashboard-page h1, .ant-page-header-heading-title")
    ).toContainText("Compliance Dashboard");
  });

  test("SOC 2 Overview tab is visible", async ({ page }) => {
    await page.goto("http://localhost:5173/compliance-dashboard");
    await expect(
      page.locator('.ant-tabs-tab:has-text("SOC 2 Overview")')
    ).toBeVisible();
  });

  test("Evidence tab is accessible", async ({ page }) => {
    await page.goto("http://localhost:5173/compliance-dashboard");
    await page.click('.ant-tabs-tab:has-text("Evidence")');
    await expect(
      page.locator('.ant-tabs-tab-active:has-text("Evidence")')
    ).toBeVisible();
  });

  test("Data Classification tab is accessible", async ({ page }) => {
    await page.goto("http://localhost:5173/compliance-dashboard");
    await page.click('.ant-tabs-tab:has-text("Data Classification")');
    await expect(
      page.locator('.ant-tabs-tab-active:has-text("Data Classification")')
    ).toBeVisible();
  });

  test("Policies tab is accessible", async ({ page }) => {
    await page.goto("http://localhost:5173/compliance-dashboard");
    await page.click('.ant-tabs-tab:has-text("Policies")');
    await expect(
      page.locator('.ant-tabs-tab-active:has-text("Policies")')
    ).toBeVisible();
  });
});
