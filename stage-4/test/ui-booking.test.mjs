/**
 * Unit 5 — Booking Confirmation and Creation Flow (RED tests, TDD order).
 *
 * - Sends the exact booking body
 * - Fresh UUID idempotency key per logical attempt, reused only for an
 *   identical retry after an uncertain transport outcome
 * - Distinguishes HTTP 201 (new) from HTTP 200 (replay)
 * - Displays SLOT_TAKEN and other errors
 * - Success fills the Manage context
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  startRealBackend,
  startStubBackend,
  createUi,
  submit,
  click,
  quickDemo,
  seedHours,
  waitFor,
  futureDate,
} from './helpers/ui.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Unit 5: Booking Confirmation and Creation Flow', () => {
  describe('against the real backend', () => {
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

    async function searchAndSelect({ partySize = 2, duration = 60 } = {}) {
      const { window, document } = ui;
      document.getElementById('search-restaurant-id').value = demo.restaurant;
      document.getElementById('search-date').value = futureDate();
      document.getElementById('search-party-size').value = String(partySize);
      document.getElementById('search-duration').value = String(duration);
      submit(window, document.getElementById('search-form'));
      const btn = await waitFor(() => document.querySelector('.slot-card .select-slot-btn'), {
        label: 'a slot to select',
      });
      click(window, btn);
      await waitFor(() => document.getElementById('section-book').classList.contains('active'), {
        label: 'booking section active',
      });
    }

    it('sends the exact request body', async () => {
      await searchAndSelect();
      submit(ui.window, ui.document.getElementById('booking-form'));

      await waitFor(() => ui.document.getElementById('new-booking-id') !== null, {
        label: 'new booking shown',
      });

      const post = ui.fetchLog.find((e) => e.method === 'POST' && e.url === '/v1/bookings');
      assert.ok(post, 'a booking POST was issued');
      const body = JSON.parse(post.body);
      assert.deepStrictEqual(
        Object.keys(body).sort(),
        [
          'duration_min',
          'fold',
          'idempotency_key',
          'local_start',
          'party_size',
          'restaurant_id',
          'table_ids',
        ],
        'the body has exactly the contract fields',
      );
      assert.strictEqual(body.restaurant_id, demo.restaurant);
      assert.ok(Array.isArray(body.table_ids) && body.table_ids.length >= 1);
      assert.ok(Number.isInteger(body.party_size) && body.party_size > 0);
      assert.match(body.local_start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      assert.strictEqual(body.duration_min, 60);
      assert.match(body.idempotency_key, UUID_RE, 'idempotency key is a UUID');
      assert.ok(body.fold === null || body.fold === 0 || body.fold === 1, 'fold is valid');
    });

    it('distinguishes 201 from 200 by replaying the identical retry after a reported network failure', async () => {
      const { window, document, fetchLog } = ui;
      const baseline = fetchLog.length;
      await searchAndSelect({ partySize: 4 });

      // The first POST reaches the backend (which books it, 201) but the
      // "transport" fails on the way back — an outcome the UI cannot tell
      // apart from a lost request, so the idempotency key must be kept.
      let failedOnce = false;
      const originalFetch = ui.window.fetch;
      ui.window.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        if (init.method === 'POST' && String(input).endsWith('/v1/bookings') && !failedOnce) {
          failedOnce = true;
          throw new TypeError('simulated transport failure');
        }
        return response;
      };

      submit(window, document.getElementById('booking-form'));
      const networkError = await waitFor(
        () => document.querySelector('#booking-result .message.error'),
        { label: 'network error after first attempt' },
      );
      assert.match(networkError.textContent, /\[NETWORK_ERROR\]/);

      // Second click retries the identical request with the same key.
      submit(window, document.getElementById('booking-form'));
      const replay = await waitFor(
        () => document.querySelector('#booking-result .message.success'),
        { label: 'replayed success' },
      );
      assert.match(replay.textContent, /replayed/i, 'UI says the response is a replay');

      ui.window.fetch = originalFetch;

      const posts = fetchLog.slice(baseline).filter((e) => e.method === 'POST' && e.url === '/v1/bookings');
      assert.strictEqual(posts.length, 2, 'two POSTs: the attempt and its retry');
      assert.strictEqual(posts[0].status, 201, 'first attempt created the booking');
      assert.strictEqual(posts[1].status, 200, 'retry was served by the idempotency replay');
      assert.strictEqual(
        JSON.parse(posts[0].body).idempotency_key,
        JSON.parse(posts[1].body).idempotency_key,
        'the retry reuses the same idempotency key',
      );
    });

    it('uses a fresh idempotency key for a new logical attempt after a server answer', async () => {
      const { window, document, fetchLog } = ui;
      const baseline = fetchLog.length;
      const priorKeys = new Set(
        fetchLog
          .slice(0, baseline)
          .filter((e) => e.method === 'POST' && e.url === '/v1/bookings')
          .map((p) => JSON.parse(p.body).idempotency_key),
      );

      await searchAndSelect({ partySize: 2, duration: 90 });

      submit(window, document.getElementById('booking-form'));
      await waitFor(() => ui.document.getElementById('new-booking-id') !== null, {
        label: 'second new booking shown',
      });

      const newPosts = fetchLog
        .slice(baseline)
        .filter((e) => e.method === 'POST' && e.url === '/v1/bookings')
        .map((p) => JSON.parse(p.body).idempotency_key);
      assert.strictEqual(newPosts.length, 1, 'this attempt sends exactly one booking POST');
      assert.match(newPosts[0], UUID_RE);
      assert.ok(!priorKeys.has(newPosts[0]), 'a logical attempt never reuses an earlier key');
    });

    it('success fills the Manage context', async () => {
      const { document } = ui;
      click(ui.window, document.querySelector('#booking-result .go-manage-btn'));
      await waitFor(() => document.getElementById('section-manage').classList.contains('active'), {
        label: 'manage section active',
      });
      const prefilled = document.getElementById('manage-booking-id').value;
      assert.match(prefilled, UUID_RE, 'manage input carries the latest booking id');

      const shownId = document.getElementById('new-booking-id')?.textContent;
      assert.strictEqual(shownId, prefilled, 'the booking shown is the one carried forward');
    });
  });

  describe('against a stub that answers SLOT_TAKEN', () => {
    let stub;
    let ui;
    let demo;

    before(async () => {
      stub = await startStubBackend([
        {
          match: (req) => req.method === 'GET' && req.url === '/health',
          status: 200,
          body: { status: 'ok' },
        },
        {
          match: (req) => req.method === 'POST' && req.url === '/v1/restaurants',
          status: 201,
          body: { id: '22222222-2222-4222-8222-222222222222' },
        },
        {
          match: (req) => req.method === 'POST' && req.url.endsWith('/tables'),
          status: 201,
          body: { id: '33333333-3333-4333-8333-333333333333' },
        },
        {
          match: (req) => req.method === 'GET' && req.url.includes('/availability'),
          status: 200,
          body: {
            slots: [
              {
                start_utc: '2026-12-01T17:00:00.000Z',
                start_local: '2026-12-01T12:00:00',
                table_ids: ['33333333-3333-4333-8333-333333333333'],
              },
            ],
          },
        },
        {
          match: (req) => req.method === 'POST' && req.url === '/v1/bookings',
          status: 409,
          body: { error: { code: 'SLOT_TAKEN', message: 'slot is already booked', details: {} } },
        },
      ]);
      ui = await createUi(stub.baseUrl);
      demo = await quickDemo(ui);
    });

    after(async () => {
      ui?.close();
      await stub?.close();
    });

    it('shows SLOT_TAKEN as an error and never as success', async () => {
      const { window, document } = ui;

      document.getElementById('search-restaurant-id').value = demo.restaurant;
      document.getElementById('search-date').value = '2026-12-01';
      document.getElementById('search-party-size').value = '2';
      document.getElementById('search-duration').value = '90';
      submit(window, document.getElementById('search-form'));
      const btn = await waitFor(() => document.querySelector('.slot-card .select-slot-btn'), {
        label: 'stub slot select',
      });
      click(window, btn);
      await waitFor(() => document.getElementById('section-book').classList.contains('active'), {
        label: 'book active',
      });

      submit(window, document.getElementById('booking-form'));
      const error = await waitFor(() => document.querySelector('#booking-result .message.error'), {
        label: 'SLOT_TAKEN error shown',
      });
      assert.match(error.textContent, /\[SLOT_TAKEN\]/, 'original backend code preserved');
      assert.match(error.textContent, /taken/i, 'friendly explanation shown');
      assert.strictEqual(document.querySelector('#booking-result .message.success'), null,
        'a failure is never transformed into success');
      assert.strictEqual(document.getElementById('new-booking-id'), null);
    });
  });
});