/**
 * Social Insights Page E2E Tests
 * Verifies the SocialInsightsPage renders correctly with expected elements.
 */

import { test, expect } from "@playwright/test";

test.describe("Social Insights Page", () => {
  test("page loads and shows title", async ({ page }) => {
    await page.goto("http://localhost:5173/social-insights");
    await expect(
      page.locator(".social-insights-page .ant-page-header-heading-title, .social-insights-page h1, .ant-page-header-heading-title")
    ).toContainText("Social Insights");
  });

  test("Topic Analysis tab is visible", async ({ page }) => {
    await page.goto("http://localhost:5173/social-insights");
    await expect(
      page.locator('.ant-tabs-tab:has-text("Topic Analysis")')
    ).toBeVisible();
  });

  test("Analyze button is visible on topic tab", async ({ page }) => {
    await page.goto("http://localhost:5173/social-insights");
    await expect(
      page.locator('button:has-text("Analyze")')
    ).toBeVisible();
  });

  test("can switch to AI Reply Suggestions tab", async ({ page }) => {
    await page.goto("http://localhost:5173/social-insights");
    await page.click('.ant-tabs-tab:has-text("AI Reply Suggestions")');
    await expect(
      page.locator('.ant-tabs-tab-active:has-text("AI Reply Suggestions")')
    ).toBeVisible();
  });

  test("can switch to Social Graph tab", async ({ page }) => {
    await page.goto("http://localhost:5173/social-insights");
    await page.click('.ant-tabs-tab:has-text("Social Graph")');
    await expect(
      page.locator('.ant-tabs-tab-active:has-text("Social Graph")')
    ).toBeVisible();
  });
});
