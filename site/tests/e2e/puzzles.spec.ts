import { expect, test, type Page } from "@playwright/test";

/** Pretend the reader has read up to a given point (furthest page per book). */
async function readTo(page: Page, furthest: Record<string, number>) {
  await page.goto("/about/");
  await page.evaluate((f) => localStorage.setItem("twice-born:v1", JSON.stringify({ furthest: f })), furthest);
}

async function openParchment(page: Page, hash = "") {
  await page.goto(`/parchment/${hash}`);
  await page.locator('.parchment-game[data-hydrated="true"]').waitFor();
}

test("puzzles open as the story reaches them", async ({ page }) => {
  await readTo(page, { b1: 42, b2: 34, b3: 20 });
  await openParchment(page);
  await expect(page.getByRole("button", { name: "Puzzle 1: The tree with an eye", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Puzzle 2: .*not yet reached/ })).toBeVisible();
});

test("solving puzzle 1: wrong answers give hints, the chain ends at Dronagiri", async ({ page }) => {
  await readTo(page, { b1: 42, b2: 34, b3: 20 });
  await openParchment(page, "#p1");
  const answers = ["Shiva", "Gyaneshwar", "Kaal Bhairava temple", "garbhagriha", "Mount Dronagiri"];
  await page.getByRole("button", { name: "Vishnu", exact: true }).click();
  await expect(page.getByText(/Hint:/)).toBeVisible();
  for (const [i, a] of answers.entries()) {
    await page.getByRole("button", { name: a, exact: true }).click();
    await page.getByRole("button", { name: i === answers.length - 1 ? "Finish" : "Next step" }).click();
  }
  await expect(page.locator(".parchment-game .outcome")).toContainText("Mount Dronagiri");
  await expect(page.locator(".parchment-game .score")).toHaveText("1 of 5 solved");
});

test("the guided walkthrough waits until the characters solve it", async ({ page }) => {
  await readTo(page, { b1: 42, b2: 34, b3: 20 }); // puzzle 1 is solved on B3 p23
  await openParchment(page, "#p1");
  await page.getByRole("button", { name: "Show me how they did it" }).click();
  await expect(page.locator(".parchment-game .solve")).toContainText("Book 3, page 23");
  await readTo(page, { b1: 42, b2: 34, b3: 23 });
  await openParchment(page, "#p1");
  await expect(page.locator(".parchment-game .answer")).toContainText("Shiva");
});

test("a puzzle hotspot in the comic leads to the puzzle", async ({ page }) => {
  await page.goto("/read/b3/19");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: /Note: Puzzle 1/ }).click();
  await page.getByRole("link", { name: "Try the puzzle →" }).click();
  await expect(page).toHaveURL(/\/parchment\/#p1$/);
});

test("the caves: decode pi, then count exits", async ({ page }) => {
  await readTo(page, { b1: 42, b2: 30 });
  await page.goto("/caves/");
  await page.locator('.caves-game[data-hydrated="true"]').waitFor();
  for (const d of [3, 1, 4, 1, 5, 9, 2, 6]) {
    await page.locator(".keypad").getByRole("button", { name: String(d), exact: true }).click();
  }
  await page.getByRole("button", { name: "Enter the Bhoodara caves" }).click();
  await page.getByRole("button", { name: "Show the numbers" }).click();
  await page.getByRole("button", { name: "Exit 2", exact: true }).click(); // wrong: first digit is 3
  await expect(page.getByRole("alert")).toContainText("dead end");
  await page.getByRole("button", { name: "Exit 3", exact: true }).click();
  await expect(page.locator(".chamber-step .eyebrow")).toContainText("chamber 2 of 8");
});
