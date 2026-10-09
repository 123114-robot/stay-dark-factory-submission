/**
 * Shared bits for the Stage 4 Playwright suite.
 *
 * - picks one disposable SQLite database for the whole run
 * - seeds a restaurant + tables through the public API (fronted by the
 *   composed proxy), which also prepares default hours via the composition
 *   layer's onRestaurantCreated hook (TASK.md R3) — no direct
 *   restaurant_hours INSERT happens in E2E anymore.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FRONTEND_BASE = 'http://127.0.0.1:8180';
export const UNREACHABLE_BASE = 'http://127.0.0.1:8181';
export const UNREACHABLE_TAB = 'tab2';

export const E2E_DIR =
  process.env.TKE2E_DIR ??
  (() => {
    const dir = mkdtempSync(join(tmpdir(), 'tablekeeper-e2e-'));
    process.env.TKE2E_DIR = dir;
    return dir;
  })();
export const E2E_DB = join(E2E_DIR, 'e2e.db');

export function futureLocalDate(daysAhead = 7) {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Create a restaurant and two tables through the public API as fronted by
 * the composed proxy. The composition layer prepares default hours for the
 * restaurant as part of the proxied POST /v1/restaurants (TASK.md R3), so no
 * direct restaurant_hours write happens here.
 */
export async function seedRestaurant(apiBase = FRONTEND_BASE) {
  const restaurantResponse = await fetch(`${apiBase}/v1/restaurants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `E2E Diner ${Date.now()}`, timezone: 'America/New_York' }),
  });
  if (!restaurantResponse.ok) {
    throw new Error(`seeding restaurant failed: ${restaurantResponse.status}`);
  }
  const restaurantId = (await restaurantResponse.json()).id;

  const small = await fetch(`${apiBase}/v1/restaurants/${restaurantId}/tables`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seats: 2 }),
  });
  const large = await fetch(`${apiBase}/v1/restaurants/${restaurantId}/tables`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seats: 4 }),
  });
  const smallId = (await small.json()).id;
  const largeId = (await large.json()).id;

  return { restaurantId, smallId, largeId };
}