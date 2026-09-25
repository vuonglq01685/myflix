import { test, expect } from "@playwright/test";

/** E2E-1 (doc 13 §6), first steps only until Phase 2 lands the auth forms. */
test.describe("E2E-1 — new user entry", () => {
  test("unauthenticated /browse is redirected to /login", async ({ page }) => {
    await page.goto("/browse");
    await expect(page).toHaveURL(/\/login\?next=%2Fbrowse/);
  });

  test("/login renders", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.ok()).toBe(true);
    await expect(page.locator("main")).toBeVisible();
  });
});
