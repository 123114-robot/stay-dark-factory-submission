/**
 * Unit 3 — Setup and Quick Demo Flow (RED tests, TDD order).
 *
 * - Creates restaurant and tables in order
 * - Stops and reports the exact failed step on partial failure
 * - Successful setup fills the search context
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  startRealBackend,
  startStubBackend,
  createUi,
  submit,
  quickDemo,
  waitFor,
} from './helpers/ui.mjs';

describe('Unit 3: Setup and Quick Demo Flow', () => {
  describe('Manual setup creates restaurant and tables in order', () => {
    let backend;
    let ui;

    before(async () => {
      backend = await startRealBackend();
      ui = await createUi(backend.baseUrl);
    });

    after(async () => {
      ui?.close();
      await backend?.close();
    });

    it('creates the restaurant before any table, then tables in click order', async () => {
      const { window, document, fetchLog } = ui;

      document.getElementById('restaurant-name').value = 'Order Test Diner';
      document.getElementById('restaurant-timezone').value = 'Europe/London';
      submit(window, document.getElementById('restaurant-form'));

      const restaurantDone = await waitFor(
        () => document.querySelector('#restaurant-result .message.success'),
        { label: 'restaurant created message' },
      );
      const restaurantId = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
        restaurantDone.textContent,
      )?.[1];
      assert.ok(restaurantId, 'a UUID restaurant id is displayed');

      document.getElementById('table-seats').value = '2';
      submit(window, document.getElementById('table-form'));
      await waitFor(() => [...document.querySelectorAll('#tables-list .tables-table tbody tr')].length >= 1, {
        label: 'first table created',
      });

      document.getElementById('table-seats').value = '5';
      submit(window, document.getElementById('table-form'));
      await waitFor(() => [...document.querySelectorAll('#tables-list .tables-table tbody tr')].length >= 2, {
        label: 'second table created',
      });

      const posts = fetchLog.filter((entry) => entry.method === 'POST');
      assert.strictEqual(posts.length, 3, 'one restaurant POST then two table POSTs');
      assert.match(posts[0].url, /^\/v1\/restaurants$/, 'first request creates the restaurant');
      assert.ok(
        posts[1].url.startsWith(`/v1/restaurants/${restaurantId}/tables`),
        'second request creates table 1 for that restaurant',
      );
      assert.ok(
        posts[2].url.startsWith(`/v1/restaurants/${restaurantId}/tables`),
        'third request creates table 2 for that restaurant',
      );
      assert.deepStrictEqual(JSON.parse(posts[1].body), { seats: 2 });
      assert.deepStrictEqual(JSON.parse(posts[2].body), { seats: 5 });

      // Created identifiers and capacities are displayed.
      const tableRows = [...document.querySelectorAll('#tables-list tbody tr')];
      assert.strictEqual(tableRows.length, 2, 'both tables are listed');
      assert.match(tableRows[0].textContent, /2/);
      assert.match(tableRows[1].textContent, /5/);
    });

    it('fills the search context after successful setup', async () => {
      const { document } = ui;
      // The context summary shows the restaurant, and the search form is pre-filled.
      const summary = document.getElementById('context-restaurant').textContent;
      assert.match(summary, /Order Test Diner/);
      assert.match(summary, /[0-9a-f]{8}-[0-9a-f]{4}-/i);

      // Navigating to Search carries the active restaurant into the field.
      const searchNav = [...document.querySelectorAll('.nav-btn')].find(
        (btn) => btn.dataset.section === 'search',
      );
      searchNav.click();
      assert.strictEqual(document.getElementById('search-restaurant-id').value.length, 36,
        'search form carries the active restaurant id');
    });

    it('blocks duplicate restaurant submits while one is pending', async () => {
      const { window, document, fetchLog } = ui;
      const postsBefore = fetchLog.filter((e) => e.method === 'POST' && e.url === '/v1/restaurants').length;

      // Fill the form, then fire two submits back to back with no await between.
      document.getElementById('restaurant-name').value = 'Burst Diner';
      document.getElementById('restaurant-timezone').value = 'Europe/London';
      submit(window, document.getElementById('restaurant-form'));
      submit(window, document.getElementById('restaurant-form'));

      await waitFor(
        () => {
          const msg = document.querySelector('#restaurant-result .message');
          const posts = fetchLog.filter(
            (e) => e.method === 'POST' && e.url === '/v1/restaurants',
          ).length;
          return (
            msg !== null &&
            !msg.classList.contains('loading') &&
            posts === postsBefore + 1
          );
        },
        { label: 'burst submit settles' },
      );

      const postsAfter = fetchLog.filter((e) => e.method === 'POST' && e.url === '/v1/restaurants').length;
      assert.strictEqual(
        postsAfter - postsBefore,
        1,
        'exactly one POST leaves the browser for a double submit',
      );
    });
  });

  describe('Quick Demo Setup', () => {
    let backend;
    let ui;

    before(async () => {
      backend = await startRealBackend();
      ui = await createUi(backend.baseUrl);
    });

    after(async () => {
      ui?.close();
      await backend?.close();
    });

    it('creates one restaurant and two tables through valid API requests', async () => {
      const { fetchLog, document } = ui;
      const demo = await quickDemo(ui);

      assert.ok(demo.restaurant, 'restaurant id shown');
      assert.strictEqual(demo.tables.length, 2, 'two table ids shown');

      const posts = fetchLog.filter((e) => e.method === 'POST');
      assert.strictEqual(posts.length, 3, 'exactly three API calls: restaurant, table, table');
      assert.strictEqual(posts[0].url, '/v1/restaurants');
      assert.deepStrictEqual(JSON.parse(posts[0].body), {
        name: 'Demo Restaurant',
        timezone: 'America/New_York',
      });
      assert.ok(posts[1].url.endsWith('/tables'));
      assert.deepStrictEqual(JSON.parse(posts[1].body), { seats: 2 });
      assert.deepStrictEqual(JSON.parse(posts[2].body), { seats: 4 });

      // Identifiers and capacities are displayed.
      assert.ok(document.getElementById('demo-restaurant-id'));
      const listText = document.getElementById('tables-list').textContent;
      assert.match(listText, /2\s+seats|seats/i);

      // Auto-carry into Search.
      document.querySelector('.nav-btn[data-section="search"]').click();
      assert.strictEqual(document.getElementById('search-restaurant-id').value, demo.restaurant);
    });
  });

  describe('Quick Demo partial failure stops and names the failed step', () => {
    let stub;
    let ui;

    before(async () => {
      // The restaurant is created, but every table creation fails.
      stub = await startStubBackend([
        {
          match: (req) => req.method === 'POST' && req.url === '/v1/restaurants',
          status: 201,
          body: { id: '11111111-2222-3333-4444-555555555555' },
        },
        {
          match: (req) => req.method === 'POST' && req.url.endsWith('/tables'),
          status: 500,
          body: { error: { code: 'INTERNAL', message: 'table store failed' } },
        },
      ]);
      ui = await createUi(stub.baseUrl);
    });

    after(async () => {
      ui?.close();
      await stub?.close();
    });

    it('reports the exact failed step and sends no further requests', async () => {
      const { window, document, fetchLog } = ui;
      clickSafe(window, document.getElementById('quick-demo-btn'));

      const failure = await waitFor(() => document.querySelector('#quick-demo-result .message.error'), {
        label: 'quick demo failure message',
      });
      const text = failure.textContent;
      assert.match(text, /table 1 failed/i, 'names the exact step that failed');
      assert.match(text, /11111111-2222-3333-4444-555555555555/, 'shows what was already created');
      assert.match(text, /\[INTERNAL\]/, 'keeps the original backend code');

      // It stopped: restaurant POST, first table POST, nothing after.
      const posts = fetchLog.filter((e) => e.method === 'POST');
      assert.strictEqual(posts.length, 2, 'no third request after the failure');

      // And no success is ever shown for a failed run.
      assert.strictEqual(document.querySelector('#quick-demo-result .message.success'), null);
    });
  });
});

function clickSafe(window, element) {
  element.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
}
