import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createUi, startStubBackend, submit, waitFor, futureDate } from './helpers/ui.mjs';

/**
 * Unit 2 — request helper, state, idempotency key rules.
 *
 * TASK.md section 9 (R2): the dead standalone helper module was deleted; all
 * coverage here exercises the canonical shipped `app.js` through the shared
 * jsdom harness (`createUi`) against `startStubBackend` routes, including the
 * shipped malformed-availability path at app.js:677-680.
 *
 * State is only manipulated through shipped DOM handlers and window-level
 * functions (saveContext/loadContext/clearContext), never by assigning app.js
 * lexical variables from outside.
 */

const STORAGE_KEY = 'tablekeeper_context';

const BOOKING = {
  id: 'booking-789',
  status: 'confirmed',
  restaurant_id: 'rest-123',
  party_size: 2,
  start_utc: '2030-01-05T19:00:00.000Z',
  duration_min: 60,
  created_at_utc: '2030-01-01T00:00:00.000Z',
};

const SLOT = {
  start_local: 'Jan 5, 2030, 7:00 PM',
  start_utc: '2030-01-05T19:00:00.000Z',
  table_ids: ['table-1', 'table-2'],
};

const ROUTES = [
  { match: (r) => r.url === '/health', status: 200, body: { status: 'ok' } },
  {
    match: (r) => r.method === 'POST' && r.url === '/v1/restaurants',
    status: 201,
    body: { id: 'rest-123', name: 'Ctx Cafe', timezone: 'America/New_York' },
  },
  {
    match: (r) => r.method === 'POST' && r.url === '/v1/restaurants/rest-123/tables',
    status: 201,
    body: { id: 'table-42' },
  },
  { match: (r) => r.method === 'GET' && r.url.startsWith('/v1/bookings/'), status: 200, body: BOOKING },
  { match: (r) => r.method === 'POST' && r.url === '/v1/bookings', status: 201, body: { id: 'booking-100', status: 'confirmed' } },
  {
    match: (r) => r.method === 'POST' && r.url.startsWith('/v1/bookings?'),
    status: 200,
    body: { id: 'booking-100', status: 'confirmed' },
  },
  { match: (r) => r.method === 'DELETE' && r.url.startsWith('/v1/bookings/'), status: 204 },
  {
    match: (r) => r.url === '/v1/error-envelope',
    status: 409,
    body: { error: { code: 'SLOT_TAKEN', message: 'slot already taken' } },
  },
  { match: (r) => r.url === '/v1/malformed', status: 200, raw: 'this is not json' },
  { match: (r) => r.url === '/v1/slow', status: 200, body: { slow: true }, delayMs: 250 },
  {
    match: (r) => r.url.includes('/availability') && r.url.includes('rest-ok'),
    status: 200,
    body: { slots: [SLOT] },
  },
  { match: (r) => r.url.includes('/availability'), status: 200, body: { slots: 'not-a-list' } },
];

let stub;
let app;
let deadPort;

before(async () => {
  stub = await startStubBackend(ROUTES);

  // A port that is guaranteed to refuse connections: bind, capture, release.
  const probe = createServer(() => {});
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  deadPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  app = await createUi(stub.baseUrl);
});

after(async () => {
  if (app) app.close();
  if (stub) await stub.close();
});

beforeEach(() => {
  app.window.clearContext();
});

function storedContext() {
  const raw = app.window.sessionStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function lastLog(method, path) {
  return app.fetchLog.filter((entry) => entry.method === method && entry.url.startsWith(path)).at(-1);
}

async function createRestaurantViaUi(name = 'Ctx Cafe') {
  app.document.getElementById('restaurant-name').value = name;
  app.document.getElementById('restaurant-timezone').value = 'America/New_York';
  submit(app.window, app.document.getElementById('restaurant-form'));
  await waitFor(
    () => app.document.getElementById('restaurant-result').querySelector('.message.success') !== null,
    { label: 'restaurant created' },
  );
}

async function createTableViaUi(seats = '2') {
  app.document.getElementById('table-seats').value = seats;
  submit(app.window, app.document.getElementById('table-form'));
  await waitFor(
    () => app.document.getElementById('tables-list').querySelector('.message.success') !== null,
    { label: 'table created' },
  );
}

async function retrieveBookingViaUi(bookingId = 'booking-789') {
  app.document.getElementById('manage-booking-id').value = bookingId;
  submit(app.window, app.document.getElementById('manage-form'));
  await waitFor(
    () => app.document.getElementById('detail-booking-id')?.textContent === bookingId,
    { label: 'booking retrieved' },
  );
}

async function searchViaUi(restaurantId, { date = futureDate(7), partySize = '2', duration = '60' } = {}) {
  app.document.getElementById('search-restaurant-id').value = restaurantId;
  app.document.getElementById('search-date').value = date;
  app.document.getElementById('search-party-size').value = partySize;
  app.document.getElementById('search-duration').value = duration;
  submit(app.window, app.document.getElementById('search-form'));
}

describe('API Request Helper', () => {
  it('handles JSON success responses', async () => {
    const result = await app.window.apiRequest(`${stub.baseUrl}/health`);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    // data was parsed inside the jsdom realm; assert fields, not prototypes.
    assert.equal(result.data.status, 'ok');
  });

  it('handles 204 success with no content', async () => {
    const result = await app.window.apiRequest(`${stub.baseUrl}/v1/bookings/booking-456`, { method: 'DELETE' });
    assert.equal(result.ok, true);
    assert.equal(result.status, 204);
    assert.equal(result.data, null);
  });

  it('handles backend error envelope', async () => {
    const result = await app.window.apiRequest(`${stub.baseUrl}/v1/error-envelope`);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.error.code, 'SLOT_TAKEN');
  });

  it('handles malformed JSON responses', async () => {
    const result = await app.window.apiRequest(`${stub.baseUrl}/v1/malformed`);
    assert.equal(result.ok, false);
    assert.equal(result.status, 200);
    assert.equal(result.error.code, 'MALFORMED_RESPONSE');
  });

  it('handles network failures', async () => {
    const result = await app.window.apiRequest(`http://127.0.0.1:${deadPort}/v1/ping`);
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.equal(result.error.code, 'NETWORK_ERROR');
  });

  it('preserves request method and body', async () => {
    const result = await app.window.apiRequest(`${stub.baseUrl}/v1/restaurants`, {
      method: 'POST',
      body: { name: 'Ctx Cafe', timezone: 'America/New_York' },
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);

    const logged = lastLog('POST', '/v1/restaurants');
    assert.ok(logged, 'POST /v1/restaurants missing from fetch log');
    assert.equal(logged.method, 'POST');
    assert.deepEqual(JSON.parse(logged.body), { name: 'Ctx Cafe', timezone: 'America/New_York' });
  });

  it('refuses a second submit while one is in flight (double-submit guard)', async () => {
    const first = app.window.apiRequest(`${stub.baseUrl}/v1/slow`, { method: 'GET' });
    const second = await app.window.apiRequest(`${stub.baseUrl}/v1/slow`, { method: 'GET' });
    assert.equal(second.ok, false);
    assert.equal(second.pending, true);
    assert.equal(second.error.code, 'PENDING');

    const done = await first;
    assert.equal(done.ok, true);
    assert.equal(done.data.slow, true);
  });
});

describe('Shipped availability rendering', () => {
  it('drives a non-array availability payload to [MALFORMED_RESPONSE] (app.js:677-680)', async () => {
    await searchViaUi('rest-123');
    await waitFor(
      () => app.document.getElementById('search-results').textContent.includes('[MALFORMED_RESPONSE]'),
      { label: 'malformed search result' },
    );
    assert.equal(app.document.querySelectorAll('.slot-card').length, 0);
  });

  it('renders slot cards from an array payload', async () => {
    await searchViaUi('rest-ok');
    await waitFor(() => app.document.querySelectorAll('.slot-card').length === 1, {
      label: 'slot rendered',
    });
    const card = app.document.querySelector('.slot-card');
    assert.ok(card.querySelector('.slot-time').textContent.includes('Jan 5, 2030, 7:00 PM'));
    assert.equal(card.querySelector('.table-ids').textContent, 'table-1, table-2');
    assert.ok(card.querySelector('.select-slot-btn'));
  });
});

describe('State Management', () => {
  it('stores context when a restaurant and table are created', async () => {
    await createRestaurantViaUi();
    await createTableViaUi();

    const ctx = storedContext();
    assert.equal(ctx.restaurant.id, 'rest-123');
    assert.equal(ctx.restaurant.name, 'Ctx Cafe');
    assert.equal(ctx.restaurant.timezone, 'America/New_York');
    assert.equal(ctx.tables.length, 1);
    assert.deepEqual(ctx.tables[0], { id: 'table-42', seats: 2 });
    assert.equal(ctx.booking, null);
  });

  it('retrieves context from sessionStorage into the UI', async () => {
    app.window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        restaurant: { id: 'rest-store', name: 'Stored Cafe', timezone: 'Europe/London' },
        tables: [{ id: 't9', seats: 4 }],
        booking: null,
        latest_booking_id: null,
      }),
    );

    app.window.loadContext();
    app.window.updateContextDisplay();

    const summary = app.document.getElementById('context-summary');
    assert.equal(summary.style.display, 'block');
    assert.equal(app.document.getElementById('context-restaurant').textContent, 'Stored Cafe (rest-store)');
    assert.ok(app.document.getElementById('context-tables').textContent.includes('t9 - 4 seats'));
    assert.equal(app.document.getElementById('table-setup-card').style.display, 'block');
  });

  it('merges new context with existing', async () => {
    app.window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        restaurant: { id: 'rest-merged', name: 'Merged Cafe', timezone: 'Europe/London' },
        tables: [
          { id: 'tm1', seats: 2 },
          { id: 'tm2', seats: 4 },
        ],
        booking: null,
        latest_booking_id: null,
      }),
    );
    app.window.loadContext();

    await retrieveBookingViaUi();

    const ctx = storedContext();
    assert.equal(ctx.restaurant.id, 'rest-merged');
    assert.equal(ctx.tables.length, 2);
    assert.equal(ctx.booking.id, 'booking-789');
    assert.equal(ctx.latest_booking_id, 'booking-789');
  });

  it('clearContext removes the stored context', async () => {
    await createRestaurantViaUi();
    assert.ok(app.window.sessionStorage.getItem(STORAGE_KEY));

    app.window.clearContext();

    assert.equal(app.window.sessionStorage.getItem(STORAGE_KEY), null);
    assert.equal(app.document.getElementById('context-summary').style.display, 'none');
    assert.equal(app.document.getElementById('table-setup-card').style.display, 'none');
    assert.equal(app.document.getElementById('search-restaurant-id').value, '');
    assert.equal(app.document.getElementById('manage-booking-id').value, '');
  });

  it('carries the latest restaurant context forward when a booking is stored', async () => {
    await createRestaurantViaUi();
    await retrieveBookingViaUi();

    const ctx = storedContext();
    assert.equal(ctx.booking.id, 'booking-789');
    assert.equal(ctx.restaurant.id, 'rest-123');
    assert.equal(ctx.restaurant.name, 'Ctx Cafe');
    assert.equal(ctx.latest_booking_id, 'booking-789');
  });
});

describe('Action Helpers', () => {
  it('creates restaurant and tables in order', async () => {
    await createRestaurantViaUi();
    await createTableViaUi();

    const posts = app.fetchLog.filter(
      (entry) => entry.method === 'POST' && entry.url.includes('/v1/restaurants'),
    );
    const restaurantPost = posts.findIndex((entry) => entry.url === '/v1/restaurants');
    const tablePost = posts.findIndex((entry) => entry.url === '/v1/restaurants/rest-123/tables');
    assert.ok(restaurantPost !== -1, 'restaurant POST missing');
    assert.ok(tablePost !== -1, 'table POST missing');
    assert.ok(restaurantPost < tablePost, 'restaurant must be created before its tables');
    assert.deepEqual(JSON.parse(posts[tablePost].body), { seats: 2 });
  });

  it('generates unique idempotency keys', () => {
    const first = app.window.generateIdempotencyKey();
    const second = app.window.generateIdempotencyKey();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.match(first, uuid);
    assert.match(second, uuid);
    assert.notEqual(first, second);
  });

  it('distinguishes 201 from 200 (idempotent replay)', async () => {
    const created = await app.window.apiRequest(`${stub.baseUrl}/v1/bookings`, {
      method: 'POST',
      body: { restaurant_id: 'rest-123', table_ids: ['table-1'], party_size: 2 },
    });
    assert.equal(created.ok, true);
    assert.equal(created.status, 201);
    assert.equal(created.isNew, true);
    assert.equal(created.isReplay, false);

    const replay = await app.window.apiRequest(`${stub.baseUrl}/v1/bookings?replay=1`, {
      method: 'POST',
      body: { restaurant_id: 'rest-123', table_ids: ['table-1'], party_size: 2 },
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.status, 200);
    assert.equal(replay.isNew, false);
    assert.equal(replay.isReplay, true);
  });

  it('retrieves booking by ID', async () => {
    const result = await app.window.apiRequest(`${stub.baseUrl}/v1/bookings/booking-789`, { method: 'GET' });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.data.id, 'booking-789');
    assert.equal(result.data.status, 'confirmed');
  });

  it('cancels booking through the Manage flow', async () => {
    await createRestaurantViaUi();
    await retrieveBookingViaUi();

    app.document.getElementById('confirm-cancel-btn').click();
    await waitFor(
      () => app.document.getElementById('booking-details').textContent.includes('was cancelled'),
      { label: 'cancel confirmation' },
    );

    const ctx = storedContext();
    assert.equal(ctx.booking, null);
    assert.equal(ctx.restaurant.id, 'rest-123');
    const deleted = app.fetchLog.findLast(
      (entry) => entry.method === 'DELETE' && entry.url === '/v1/bookings/booking-789',
    );
    assert.ok(deleted, 'DELETE /v1/bookings/booking-789 missing from fetch log');
  });
});

describe('Validation', () => {
  it('validates party size as positive integer', () => {
    assert.equal(app.window.validatePartySize(2), true);
    assert.equal(app.window.validatePartySize(0), false);
    assert.equal(app.window.validatePartySize(-1), false);
    assert.equal(app.window.validatePartySize(1.5), false);
    assert.equal(app.window.validatePartySize(Number.NaN), false);
  });

  it('validates duration (positive, <=720, divisible by 15)', () => {
    assert.equal(app.window.validateDuration(15), true);
    assert.equal(app.window.validateDuration(60), true);
    assert.equal(app.window.validateDuration(720), true);
    assert.equal(app.window.validateDuration(7), false);
    assert.equal(app.window.validateDuration(30.5), false);
    assert.equal(app.window.validateDuration(735), false);
  });

  it('validates date format', () => {
    assert.equal(app.window.validateDate('2030-01-05'), true);
    assert.equal(app.window.validateDate('2030-1-5'), false);
    assert.equal(app.window.validateDate('2030-13-01'), false);
    assert.equal(app.window.validateDate('2030-02-30'), false);
    assert.equal(app.window.validateDate(''), false);
    assert.equal(app.window.validateDate('yesterday'), false);
  });
});
