/**
 * Stage 4 E2E — the canonical product surface in a real browser.
 *
 * 1. Happy path: Quick Demo Setup → search → pick → confirm → verify → cancel
 * 2. Double-booking refused with SLOT_TAKEN, never a false success
 * 3. Invalid duration refused client-side with no request sent
 * 4. Backend unavailable: banner + deterministic 503, not a spinner forever
 * 5. A narrow mobile viewport has no horizontal overflow
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_BASE, UNREACHABLE_BASE, futureLocalDate, seedRestaurant } from './harness.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function fillSearch(page, restaurantId, { date, partySize = 2, duration = 60 } = {}) {
  await page.getByRole('button', { name: /search/i }).click();
  await page.fill('#search-restaurant-id', restaurantId);
  await page.fill('#search-date', date ?? futureLocalDate());
  await page.fill('#search-party-size', String(partySize));
  await page.fill('#search-duration', String(duration));
  await page.click('#search-form button[type="submit"]');
}

async function searchAndPick(page, restaurantId, options) {
  await fillSearch(page, restaurantId, options);
  await expect(page.locator('.slot-card').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('.slot-card .select-slot-btn').first().click();
  await expect(page.locator('#section-book')).toHaveClass(/active/);
}

async function confirmBooking(page) {
  await page.click('#booking-form button[type="submit"]');
  await expect(page.locator('#booking-result .message.success')).toBeVisible({ timeout: 10_000 });
  const id = (await page.locator('#new-booking-id').textContent()) ?? '';
  expect(id).toMatch(UUID_RE);
  return id;
}

test.describe('TableKeeper Stage 4 end to end', () => {
  let seeded;

  test.beforeAll(async () => {
    seeded = await seedRestaurant();
  });

  test('happy path: quick demo setup, search, book, verify, cancel', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#connection-status')).toHaveClass(/connected/);

    // TASK scenario 1 starts at Quick Demo Setup: one restaurant + two tables
    // created through the real API from the button.
    await page.locator('.nav-btn[data-section="setup"]').click();
    await page.click('#quick-demo-btn');
    await expect(page.locator('#quick-demo-result .message.success')).toBeVisible({ timeout: 10_000 });
    const restaurantId = (await page.locator('#demo-restaurant-id').textContent()) ?? '';
    expect(restaurantId).toMatch(UUID_RE);

    // No hours seeding here: the composition layer (deploy/demo.mjs injected
    // into serve.mjs's onRestaurantCreated hook) prepared default hours while
    // Quick Demo's POST /v1/restaurants was in flight (TASK.md R3).

    await searchAndPick(page, restaurantId);
    const bookingId = await confirmBooking(page);

    // Verify in Manage...
    await page.locator('#booking-result .go-manage-btn').click();
    await expect(page.locator('#section-manage')).toHaveClass(/active/);
    await expect(page.locator('#manage-booking-id')).toHaveValue(bookingId);
    await page.click('#manage-form button[type="submit"]');
    await expect(page.locator('#detail-booking-id')).toHaveText(bookingId);
    await expect(page.locator('#booking-details .status-badge')).toHaveText(/confirmed/i);

    // ...then cancel with an in-page confirmation.
    await expect(page.locator('#cancel-section')).toHaveCSS('display', 'block');
    await page.click('#confirm-cancel-btn');
    await expect(page.locator('#booking-details .message.success')).toContainText(/cancelled/i);
  });

  test('a slot already taken is refused and never shown as a success', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Both pages load the same slot list before anyone books.
    await pageA.goto('/');
    await pageB.goto('/');
    await searchAndPick(pageA, seeded.restaurantId);
    await searchAndPick(pageB, seeded.restaurantId);
    const firstSlotUtc = await pageA.locator('.slot-card .slot-utc').first().textContent();
    await expect(pageB.locator('.slot-card .slot-utc').first()).toHaveText(firstSlotUtc ?? '');

    // Page A takes the slot.
    await confirmBooking(pageA);

    // Page B tries the same slot and must be refused with SLOT_TAKEN.
    await pageB.click('#booking-form button[type="submit"]');
    await expect(pageB.locator('#booking-result .message.error')).toBeVisible({ timeout: 10_000 });
    await expect(pageB.locator('#booking-result .message.error')).toContainText('[SLOT_TAKEN]');
    await expect(pageB.locator('#booking-result .message.success')).toHaveCount(0);
    await expect(pageB.locator('#new-booking-id')).toHaveCount(0);

    await contextA.close();
    await contextB.close();
  });

  test('an invalid duration is refused client-side before any request', async ({ page }) => {
    let availabilityRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/availability')) availabilityRequests += 1;
    });

    await page.goto('/');
    await fillSearch(page, seeded.restaurantId, { duration: 20 });
    await expect(page.locator('#search-form-error')).toContainText(/15 to 720/i);

    // No slot list and, critically, nothing left the browser.
    await expect(page.locator('.slot-card')).toHaveCount(0);
    expect(availabilityRequests).toBe(0);
  });

  test('an unreachable backend shows a banner and a deterministic 503', async ({ page }) => {
    await page.goto(UNREACHABLE_BASE);
    await expect(page.locator('#connection-status')).toHaveClass(/unavailable/);
    await expect(page.locator('#connection-status .status-text')).toContainText(/unavailable/i);

    await fillSearch(page, 'no-such-restaurant', { date: futureLocalDate() });
    await expect(page.locator('#search-results .message.error')).toContainText('[SERVICE_UNAVAILABLE]');
  });

  test('a narrow mobile viewport never overflows horizontally', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const page = await context.newPage();
    await page.goto('/');
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);

    // Navigation stays usable at that width.
    for (const section of ['setup', 'search', 'book', 'manage']) {
      await page.locator(`.nav-btn[data-section="${section}"]`).click();
      await expect(page.locator(`#section-${section}`)).toHaveClass(/active/);
    }
    await context.close();
  });
});