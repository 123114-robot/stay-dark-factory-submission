/**
 * Unit 7 — Responsive / Accessibility (RED checks, TDD order).
 *
 * - Every input has a programmatic label and an error association
 * - All actions are keyboard operable (native controls, no trap tabindex)
 * - Status has visible semantics, state is never conveyed by color alone
 * - A narrow viewport has no horizontal overflow (layout verified in E2E;
 *   this unit pins the responsive rule that makes it pass)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startRealBackend, createUi, FRONTEND_DIR } from './helpers/ui.mjs';

describe('Unit 7: Responsive and Accessibility', () => {
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

  it('gives every form control a programmatic label', () => {
    const { document } = ui;
    const controls = [...document.querySelectorAll('input, select, textarea')];
    assert.ok(controls.length >= 8, `expected several controls, found ${controls.length}`);

    for (const control of controls) {
      const hasLabelFor = Boolean(
        control.id && document.querySelector(`label[for="${control.id}"]`),
      );
      assert.ok(
        hasLabelFor,
        `control #${control.id} (${
          control.name ?? '?'
        }) must have a label[for] pointing at it`,
      );
    }
  });

  it('associates error regions with inputs via aria-describedby', () => {
    const { document } = ui;
    const described = [...document.querySelectorAll('input[aria-describedby], select[aria-describedby]')];
    assert.ok(described.length >= 6, `have error associations on ${described.length} controls`);

    for (const control of described) {
      const ids = control.getAttribute('aria-describedby').split(/\s+/);
      for (const id of ids) {
        const referenced = document.getElementById(id);
        assert.ok(
          referenced !== null,
          `#${control.id} describes #${id} which must exist`,
        );
        assert.ok(
          referenced.classList.contains('form-error') || referenced.classList.contains('help-text'),
          `#${id} should be an error or help region`,
        );
      }
    }

    // The actual error regions are role=alert so a change is announced.
    const alerts = document.querySelectorAll('[role="alert"]');
    assert.ok(alerts.length >= 4, 'each form has a live alert region');
  });

  it('keeps every action on native, keyboard-reachable elements', () => {
    const { document } = ui;
    const buttons = [...document.querySelectorAll('button')];
    assert.ok(buttons.length >= 8, 'interactive actions are real buttons');
    for (const button of buttons) {
      assert.ok(
        button.textContent.trim() !== '' || button.getAttribute('aria-label'),
        'every button has an accessible name',
      );
    }

    const hasPositiveTabIndex = [...document.querySelectorAll('[tabindex]')].some(
      (el) => Number(el.getAttribute('tabindex')) > 0,
    );
    assert.strictEqual(hasPositiveTabIndex, false, 'no positive tabindex traps');

    // No clickable div/span pretending to be a button.
    const fakeButtons = [...document.querySelectorAll('div[role="button"], span[onclick], div[onclick]')];
    assert.strictEqual(fakeButtons.length, 0, 'no synthetic click targets');
  });

  it('exposes status with visible semantics, not color alone', () => {
    const { document } = ui;

    // One shared aria-live region for async results.
    const live = document.querySelectorAll('#global-status[aria-live="polite"]');
    assert.strictEqual(live.length, 1, 'one global live region');

    const statusRegions = document.querySelectorAll('.connection-status[role="status"], .result, .search-results, .booking-result, .booking-details');
    assert.ok(statusRegions.length >= 3, 'async result containers are documented regions');

    // Connection state carries a text label beside any color.
    const statusText = document.querySelector('#connection-status .status-text');
    assert.ok(statusText, 'connection status has a text label');

    // Navigation marks the current page, not just colors it.
    const activeNav = document.querySelector('.nav-btn[aria-current="page"]');
    assert.ok(activeNav, 'active nav has aria-current');
  });

  it('uses one h1 and semantic section headings', () => {
    const { document } = ui;
    assert.strictEqual(document.querySelectorAll('h1').length, 1, 'exactly one h1');
    const sectionHeadings = [...document.querySelectorAll('section > h2')];
    assert.strictEqual(sectionHeadings.length, 4, 'each section opens with an h2');
  });

  it('pins a responsive rule so a narrow viewport cannot overflow horizontally', async () => {
    const css = await readFile(join(FRONTEND_DIR, 'styles.css'), 'utf8');
    assert.match(css, /@media\s*\(max-width:\s*640px\)/, 'has a narrow-viewport media query');
    assert.match(css, /overflow-wrap:\s*anywhere/, 'long ids/URLs wrap instead of overflowing');
    assert.match(css, /body\s*\{[^}]*overflow-wrap:\s*anywhere/, 'the body cannot widen the page');
  });
});

describe('Unit 7: static HTML audit', () => {
  it('has no script tags with remote sources and no external CDN links', async () => {
    const html = await readFile(join(FRONTEND_DIR, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /src="https?:|href="https?:/, 'no external resources');
  });

  it('declares lang and viewport for readers and narrow screens', async () => {
    const html = await readFile(join(FRONTEND_DIR, 'index.html'), 'utf8');
    assert.match(html, /<html lang="en">/);
    assert.match(html, /name="viewport"/);
  });
});