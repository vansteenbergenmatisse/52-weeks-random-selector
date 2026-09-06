import { test, expect, type Page } from "@playwright/test";

async function demoLogin(page: Page, who: "teresa" | "matisse") {
  await page.goto("/login");
  // Programmatic login is deterministic across viewports.
  const res = await page.request.post("/api/auth/login", {
    data: { username: who, password: "12345" },
  });
  expect(res.ok()).toBeTruthy();
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Ideas in the pool" })).toBeVisible();
}

test("demo user can sign in and see the shared space", async ({ page }) => {
  await demoLogin(page, "teresa");
  await expect(page.getByRole("banner").getByText("52")).toBeVisible();
  await expect(page.getByRole("button", { name: /Dates/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Movies/i })).toBeVisible();
});

test("both demo users see the same couple space", async ({ browser }) => {
  const c1 = await browser.newContext();
  const c2 = await browser.newContext();
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();
  await demoLogin(p1, "teresa");
  await demoLogin(p2, "matisse");
  // Couple name is hidden on small viewports (CSS), so assert it's attached in
  // the DOM for both — proving they share the same couple space.
  await expect(p1.getByText("Teresa & Matisse")).toBeAttached();
  await expect(p2.getByText("Teresa & Matisse")).toBeAttached();
  await c1.close();
  await c2.close();
});

test("can add an idea and it appears in the pool", async ({ page }) => {
  await demoLogin(page, "teresa");
  const unique = `E2E idea ${Date.now()}`;
  await page.getByRole("button", { name: /\+ Add idea/i }).click();
  await page.getByPlaceholder("Idea title").fill(unique);
  await page.getByRole("button", { name: /^Add idea$/ }).click();
  await expect(page.getByText(unique)).toBeVisible();
});

test("spin or reveal produces a locked-in weekly result", async ({ page }) => {
  await demoLogin(page, "teresa");
  // Use the Movies tab which may not have a result yet; else Dates reveal.
  const spinBtn = page.getByRole("button", { name: /spin this week|reveal this week/i });
  if (await spinBtn.isVisible().catch(() => false)) {
    await spinBtn.click();
    // Wait out the animation and assert a result panel appears.
    await expect(page.getByText(/pick is locked in|Mark done/i).first()).toBeVisible({ timeout: 15000 });
  } else {
    // Already settled — a result panel with actions must be present.
    await expect(page.getByRole("button", { name: /Mark done|Reroll/ }).first()).toBeVisible();
  }
});
