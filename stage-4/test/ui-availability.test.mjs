/**
 * Unit 4 — Availability Search Flow (RED tests, TDD order).
 *
 * - Validates date, party size, duration client-side
 * - Encodes the query correctly
 * - Renders multiple, empty, and error results
 * - A selected slot fills the booking confirmation
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  startRealBackend,
  createUi,
  submit,
  click,
  quickDemo,
  seedHours,
  waitFor,
  futureDate,
} from './helpers/ui.mjs';

describe('Unit 4: Availability Search Flow', () => {
  let backend;
  let ui;
  let demo;

  before(async () => {
    backend = await startRealBackend();
    ui = await createUi(backend.baseUrl);
    demo = await quickDemo(ui);
    seedHours(backend.db, demo.restaurant);
  });

  after(async () => {
    ui?.close();
    await backend?.close();
  });

  function fillSearch({ restaurantId = demo.restaurant, date, partySize = 2, duration = 60 } = {}) {
    const { document } = ui;
    document.getElementById('search-restaurant-id').value = restaurantId;
    document.getElementById('search-date').value = date ?? futureDate();
    document.getElementById('search-party-size').value = String(partySize);
    document.getElementById('search-duration').value = String(duration);
  }

  it('validates date, party size and duration before any request', async () => {
    const { window, document, fetchLog } = ui;
    const requestsBefore = fetchLog.length;

    // Bad date
    fillSearch({ date: '2026-99-99' });
    submit(window, document.getElementById('search-form'));
    await waitFor(() => document.getElementById('search-form-error').textContent !== '', {
      label: 'date validation message',
    });
    assert.match(document.getElementById('search-form-error').textContent, /date/i);

    // Bad party size
    fillSearch({ partySize: 0 });
    submit(window, document.getElementById('search-form'));
    await waitFor(
      () => /party size/i.test(document.getElementById('search-form-error').textContent),
      { label: 'party size validation message' },
    );

    // Bad duration (not divisible by 15)
    fillSearch({ duration: 20 });
    submit(window, document.getElementById('search-form'));
    await waitFor(
      () =>
        /duration|15 to 720|steps of 15/i.test(document.getElementById('search-form-error').textContent),
      { label: 'duration validation message' },
    );

    // Duration over the bound
    fillSearch({ duration: 721 });
    submit(window, document.getElementById('search-form'));
    await waitFor(
      () =>
        /duration|15 to 720/i.test(document.getElementById('search-form-error').textContent),
      { label: 'upper bound validation message' },
    );

    // A burst of invalid submits must not fire a single availability request.
    const availabilityRequests = fetchLog
      .slice(requestsBefore)
      .filter((e) => e.method === 'GET' && e.url.includes('/availability'));
    assert.strictEqual(availabilityRequests.length, 0, 'no network request for invalid input');
  });

  it('encodes the availability query correctly', async () => {
    const { window, document, fetchLog } = ui;
    const date = futureDate();
    fillSearch({ date, partySize: 4, duration: 90 });
    submit(window, document.getElementById('search-form'));

    await waitFor(
      () => Array.from(document.querySelectorAll('.slot-card')).length > 0,
      { label: 'availability slots rendered' },
    );

    const entry = fetchLog.find((e) => e.method === 'GET' && e.url.includes('/availability'));
    assert.ok(entry, 'an availability GET was issued');
    const url = new URL(entry.url, 'http://x');
    assert.strictEqual(url.searchParams.get('local_date'), date);
    assert.strictEqual(url.searchParams.get('party_size'), '4');
    assert.strictEqual(url.searchParams.get('duration_min'), '90');
  });

  it('renders multiple slots with local start, UTC start and table ids', async () => {
    const { document } = ui;
    const slots = Array.from(document.querySelectorAll('.slot-card'));
    assert.ok(slots.length >= 2, `expected several slots, got ${slots.length}`);

    for (const slot of slots) {
      const text = slot.textContent;
      assert.match(text, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'local start shown');
      assert.match(text, /UTC:/, 'UTC start labelled');
      assert.match(text, /[0-9a-f]{8}-[0-9a-f]{4}-/i, 'a table id is shown');
    }
  });

  it('renders an empty result as an empty state, not an error', async () => {
    const { window, document } = ui;
    // A second restaurant with no hours configured has no slots.
    const res = await fetch(`${backend.baseUrl}/v1/restaurants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Closed Forever', timezone: 'Europe/London' }),
    });
    const body = await res.json();
    const closedRestaurantId = body.id;

    fillSearch({ restaurantId: closedRestaurantId });
    submit(window, document.getElementById('search-form'));

    await waitFor(() => document.getElementById('slots-empty') !== null, {
      label: 'empty slots state',
    });
    assert.strictEqual(document.querySelector('.slot-card'), null);
  });

  it('renders a NOT_FOUND error result for an unknown restaurant', async () => {
    const { window, document } = ui;
    fillSearch({ restaurantId: '00000000-0000-4000-8000-000000000000' });
    submit(window, document.getElementById('search-form'));

    const error = await waitFor(() => document.querySelector('#search-results .message.error'), {
      label: 'availability error result',
    });
    assert.match(error.textContent, /\[NOT_FOUND\]/, 'backend code is preserved');
    assert.match(error.textContent, /restaurant/i);
  });

  it('carries a selected slot into the booking confirmation', async () => {
    const { document } = ui;
    fillSearch({ date: futureDate(), partySize: 4, duration: 60 });
    submitAndWait();

    const slot = await waitFor(() => document.querySelector('.slot-card .select-slot-btn'), {
      label: 'slot select button',
    });
    click(ui.window, slot);

    // Book section becomes active with the confirmation populated.
    await waitFor(() => document.getElementById('section-book').classList.contains('active'), {
      label: 'booking section active',
    });
    assert.strictEqual(document.getElementById('confirm-restaurant-id').textContent, demo.restaurant);
    assert.match(document.getElementById('confirm-table-ids').textContent, /[0-9a-f]{8}-[0-9a-f]{4}-/i);
    assert.strictEqual(document.getElementById('confirm-party-size').textContent, '4');
    assert.match(document.getElementById('confirm-duration').textContent, /60 minutes/);
    assert.match(document.getElementById('confirm-local-start').textContent, /T\d{2}:\d{2}/);
  });

  function submitAndWait() {
    submit(ui.window, ui.document.getElementById('search-form'));
  }
});