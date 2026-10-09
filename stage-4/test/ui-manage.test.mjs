/**
 * Unit 6 — Manage and Cancellation Flow (RED tests, TDD order).
 *
 * - Loads and renders a booking
 * - Handles NOT_FOUND
 * - Requires an in-page cancel confirmation (never window.confirm)
 * - Treats DELETE 204 as success
 * - Repeated cancellation visibly reports the backend's NOT_FOUND
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  startRealBackend,
  createUi,
  submit,
  click,
  quickDemo,
  waitFor,
  seedHours,
  futureDate,
} from './helpers/ui.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Unit 6: Manage and Cancellation Flow', () => {
  let backend;
  let ui;
  let demo;
  let booked;

  before(async () => {
    backend = await startRealBackend();
    ui = await createUi(backend.baseUrl);
    demo = await quickDemo(ui);
    seedHours(backend.db, demo.restaurant);

    // Create a real booking directly through the API so the manage tests are
    // independent of the booking UI flow covered in Unit 5.
    const response = await fetch(`${backend.baseUrl}/v1/bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        restaurant_id: demo.restaurant,
        table_ids: [demo.tables[0]],
        party_size: 2,
        local_start: `${futureDate()}T12:00`,
        duration_min: 60,
        idempotency_key: undefined,
        fold: null,
      }),
    });
    assert.strictEqual(response.status, 201);
    booked = (await response.json()).id;
  });

  after(async () => {
    ui?.close();
    await backend?.close();
  });

  function retrieve(id) {
    const { window, document } = ui;
    document.getElementById('manage-booking-id').value = id;
    submit(window, document.getElementById('manage-form'));
  }

  it('loads and renders every BookingView field', async () => {
    const { document } = ui;
    retrieve(booked);

    const details = await waitFor(() => document.querySelector('#booking-details .detail-list'), {
      label: 'booking details rendered',
    });
    const text = details.textContent;
    assert.strictEqual(document.getElementById('detail-booking-id').textContent, booked);
    assert.match(text, new RegExp(booked), 'booking id');
    assert.match(text, new RegExp(demo.restaurant), 'restaurant_id');
    assert.match(text, /2/, 'party_size');
    assert.match(text, /T\d{2}:\d{2}/, 'start_utc');
    assert.match(text, /60 minutes/, 'duration_min');
    assert.match(text, /confirmed/, 'status');
    assert.match(text, /T\d{2}:\d{2}/, 'created_at_utc');
  });

  it('handles NOT_FOUND and hides the cancel action', async () => {
    const { document } = ui;
    retrieve('00000000-0000-4000-8000-000000000000');

    const error = await waitFor(() => document.querySelector('#booking-details .message.error'), {
      label: 'NOT_FOUND error',
    });
    assert.match(error.textContent, /\[NOT_FOUND\]/);
    assert.strictEqual(document.getElementById('cancel-section').style.display, 'none');
  });

  it('requires an in-page confirmation before DELETE and never uses window.confirm', async () => {
    const { window, document, fetchLog } = ui;

    let confirmCalls = 0;
    const originalConfirm = window.confirm;
    window.confirm = () => {
      confirmCalls += 1;
      return true;
    };

    retrieve(booked);
    await waitFor(() => document.getElementById('cancel-section').style.display !== 'none', {
      label: 'cancel block shown after load',
    });

    const deletesBefore = fetchLog.filter((e) => e.method === 'DELETE').length;
    assert.strictEqual(deletesBefore, 0, 'loading a booking never sends DELETE');

    // The cancellation only happens once the user clicks the in-page confirm.
    click(window, document.getElementById('confirm-cancel-btn'));
    await waitFor(() => document.querySelector('#booking-details .message.success'), {
      label: 'cancel success',
    });

    assert.strictEqual(confirmCalls, 0, 'window.confirm must not be used');
    window.confirm = originalConfirm;
  });

  it('treats HTTP 204 from DELETE as success and marks the booking inactive', async () => {
    const { document, fetchLog } = ui;
    const deleteEntry = fetchLog.find((e) => e.method === 'DELETE');
    assert.ok(deleteEntry, 'a DELETE was issued');
    assert.strictEqual(deleteEntry.status, 204, 'the backend answered 204');

    const success = document.querySelector('#booking-details .message.success');
    assert.match(success.textContent, /cancelled/i);
    assert.match(success.textContent, new RegExp(booked), 'names the booking that was cancelled');
  });

  it('reports NOT_FOUND again when the cancelled booking is cancelled a second time', async () => {
    const { window, document } = ui;

    // Retrieving an already-cancelled booking still returns it.
    retrieve(booked);
    await waitFor(
      () => document.querySelector('#booking-details .status-badge.cancelled') !== null,
      { label: 'cancelled status rendered on reload' },
    );

    // The cancel block is available again; confirming it must fail with NOT_FOUND.
    click(window, document.getElementById('confirm-cancel-btn'));
    const error = await waitFor(
      () => document.querySelector('#booking-details .message.error'),
      { label: 'second cancellation error' },
    );
    assert.match(error.textContent, new RegExp(booked), 'the same booking id is in the message');
    assert.match(error.textContent, /\[NOT_FOUND\]/, 'repeated cancellation is visibly refused');
  });
});