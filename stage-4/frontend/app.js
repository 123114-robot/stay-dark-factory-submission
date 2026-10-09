/**
 * Tablekeeper - Main Application Logic
 *
 * Handles UI interactions, API calls, state management, and navigation.
 * Plain script (no modules) so it runs from a static file server with no build step.
 */

// Session storage key for non-secret convenience state.
const SESSION_STORAGE_KEY = 'tablekeeper_context';

// DOM element references, filled in by cacheElements().
const elements = {};

// Application state (mirrored into sessionStorage via saveContext()).
let currentRestaurant = null;
let currentTables = [];
let currentBooking = null;
let selectedSlot = null;

// True while an API request is in flight; blocks duplicate submits.
let pendingAction = false;

// The one in-flight booking attempt whose transport outcome is uncertain.
// Kept so an identical retry after a network failure reuses the same
// idempotency key; cleared as soon as the server answers for any status.
let pendingBookingAttempt = null;

// Timezone dropdown options, mirrored in index.html; validated on submit.
const VALID_TIMEZONES = [
  'Australia/Sydney',
  'America/New_York',
  'Europe/London',
  'Asia/Kathmandu',
  'Australia/Eucla',
  'Pacific/Chatham',
];

/**
 * Initialize the application.
 */
function init() {
  cacheElements();
  loadContext();
  setupEventListeners();
  setupNavigation();
  checkBackendConnection();
  updateContextDisplay();

  // Re-check the connection every 30 seconds so the shell recovers on its own.
  setInterval(checkBackendConnection, 30000);
}

function cacheElements() {
  elements.connectionStatus = document.getElementById('connection-status');
  elements.statusText = elements.connectionStatus?.querySelector('.status-text');

  elements.navButtons = document.querySelectorAll('.nav-btn');
  elements.sections = document.querySelectorAll('.section');

  elements.globalStatus = document.getElementById('global-status');

  elements.restaurantForm = document.getElementById('restaurant-form');
  elements.restaurantName = document.getElementById('restaurant-name');
  elements.restaurantTimezone = document.getElementById('restaurant-timezone');
  elements.restaurantFormError = document.getElementById('restaurant-form-error');
  elements.restaurantResult = document.getElementById('restaurant-result');
  elements.tableSetupCard = document.getElementById('table-setup-card');
  elements.tableForm = document.getElementById('table-form');
  elements.tableSeats = document.getElementById('table-seats');
  elements.tableFormError = document.getElementById('table-form-error');
  elements.tablesList = document.getElementById('tables-list');
  elements.quickDemoBtn = document.getElementById('quick-demo-btn');
  elements.quickDemoResult = document.getElementById('quick-demo-result');
  elements.contextSummary = document.getElementById('context-summary');
  elements.contextRestaurant = document.getElementById('context-restaurant');
  elements.contextTables = document.getElementById('context-tables');
  elements.clearContextBtn = document.getElementById('clear-context-btn');

  elements.searchForm = document.getElementById('search-form');
  elements.searchBtn = document.getElementById('search-btn');
  elements.searchRestaurantId = document.getElementById('search-restaurant-id');
  elements.searchDate = document.getElementById('search-date');
  elements.searchPartySize = document.getElementById('search-party-size');
  elements.searchDuration = document.getElementById('search-duration');
  elements.searchFormError = document.getElementById('search-form-error');
  elements.searchResults = document.getElementById('search-results');

  elements.bookingSummary = document.getElementById('booking-summary');
  elements.bookingForm = document.getElementById('booking-form');
  elements.confirmRestaurantId = document.getElementById('confirm-restaurant-id');
  elements.confirmTableIds = document.getElementById('confirm-table-ids');
  elements.confirmPartySize = document.getElementById('confirm-party-size');
  elements.confirmLocalStart = document.getElementById('confirm-local-start');
  elements.confirmDuration = document.getElementById('confirm-duration');
  elements.confirmBookingBtn = document.getElementById('confirm-booking-btn');
  elements.cancelBookingBtn = document.getElementById('cancel-booking-btn');
  elements.bookingResult = document.getElementById('booking-result');

  elements.manageForm = document.getElementById('manage-form');
  elements.retrieveBookingBtn = document.getElementById('retrieve-booking-btn');
  elements.manageBookingId = document.getElementById('manage-booking-id');
  elements.manageFormError = document.getElementById('manage-form-error');
  elements.bookingDetails = document.getElementById('booking-details');
  elements.cancelSection = document.getElementById('cancel-section');
  elements.confirmCancelBtn = document.getElementById('confirm-cancel-btn');
  elements.abortCancelBtn = document.getElementById('abort-cancel-btn');
}

function setupEventListeners() {
  elements.restaurantForm?.addEventListener('submit', handleCreateRestaurant);
  elements.tableForm?.addEventListener('submit', handleCreateTable);
  elements.quickDemoBtn?.addEventListener('click', handleQuickDemo);
  elements.clearContextBtn?.addEventListener('click', clearContext);
  elements.searchForm?.addEventListener('submit', handleSearch);
  elements.bookingForm?.addEventListener('submit', handleConfirmBooking);
  elements.cancelBookingBtn?.addEventListener('click', clearBookingForm);
  elements.manageForm?.addEventListener('submit', handleRetrieveBooking);
  elements.confirmCancelBtn?.addEventListener('click', handleCancelBooking);
  elements.abortCancelBtn?.addEventListener('click', hideCancelSection);
}

function setupNavigation() {
  elements.navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      showSection(section);

      // Carry the latest context into the forms the user just opened.
      if (section === 'search' && currentRestaurant) {
        elements.searchRestaurantId.value = currentRestaurant.id;
      }
      if (section === 'manage' && currentBooking) {
        elements.manageBookingId.value = currentBooking.id;
      }
    });
  });
}

function showSection(sectionName) {
  elements.navButtons.forEach((btn) => {
    const isActive = btn.dataset.section === sectionName;
    btn.classList.toggle('active', isActive);
    if (isActive) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  elements.sections.forEach((section) => {
    section.classList.toggle('active', section.id === `section-${sectionName}`);
  });
}

async function checkBackendConnection() {
  updateConnectionStatus('checking');
  try {
    const response = await fetch('/health');
    if (response.ok) {
      updateConnectionStatus('connected');
    } else {
      updateConnectionStatus('unavailable');
    }
  } catch {
    updateConnectionStatus('unavailable');
  }
}

function updateConnectionStatus(status) {
  if (!elements.connectionStatus) return;
  elements.connectionStatus.classList.remove('checking', 'connected', 'unavailable');
  elements.connectionStatus.classList.add(status);

  const statusText = {
    checking: 'Checking connection...',
    connected: 'Connected',
    unavailable: 'Backend unavailable',
  };
  if (elements.statusText) {
    elements.statusText.textContent = statusText[status];
  }
}

function showStatus(message, type = 'info') {
  if (!elements.globalStatus) return;
  elements.globalStatus.textContent = message;
  elements.globalStatus.className = `global-status ${type}`;
  elements.globalStatus.style.display = 'block';

  if (type !== 'error') {
    setTimeout(() => {
      elements.globalStatus.style.display = 'none';
    }, 5000);
  }
}

/**
 * Fresh UUID per logical attempt (RFC 4122 v4 via the platform CSPRNG).
 */
function generateIdempotencyKey() {
  return globalThis.crypto.randomUUID();
}

function validatePartySize(value) {
  return Number.isInteger(value) && value > 0;
}

function validateDuration(value) {
  return Number.isInteger(value) && value > 0 && value <= 720 && value % 15 === 0;
}

function validateDate(value) {
  if (typeof value !== 'string' || value === '') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * API request helper with error handling and a double-submit guard.
 *
 * Returns { ok, status, data, isNew, isReplay } on success or
 * { ok: false, status, error: { code, message } } on failure.
 * While a request is in flight further requests are refused with PENDING
 * unless options.allowWhilePending is set.
 */
async function apiRequest(url, options = {}) {
  if (pendingAction && options.allowWhilePending !== true) {
    return {
      ok: false,
      status: 0,
      error: { code: 'PENDING', message: 'An action is already in progress' },
      pending: true,
    };
  }

  pendingAction = true;
  const method = options.method ?? 'GET';
  const headers = { 'content-type': 'application/json', ...options.headers };
  const fetchOptions = { method, headers };
  if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    fetchOptions.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    let data = null;
    try {
      data = text === '' ? null : JSON.parse(text);
    } catch {
      return {
        ok: false,
        status: response.status,
        error: { code: 'MALFORMED_RESPONSE', message: 'The server returned an unreadable response' },
      };
    }

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        data,
        isNew: response.status === 201,
        isReplay: method === 'POST' && response.status === 200,
      };
    }
    return {
      ok: false,
      status: response.status,
      error: data?.error ?? { code: 'UNKNOWN_ERROR', message: 'The server rejected the request' },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: {
        code: 'NETWORK_ERROR',
        message: err?.message || 'Could not reach the server',
      },
    };
  } finally {
    pendingAction = false;
  }
}

/**
 * Friendly explanation for every backend error code plus the local ones,
 * with the original code appended by callers so it is never lost.
 */
function getErrorMessage(code, defaultMessage) {
  const messages = {
    SLOT_TAKEN: 'That time slot was just taken. Search again and pick another slot.',
    INVALID_TIME: 'The selected time is not valid for this restaurant.',
    AMBIGUOUS_LOCAL_TIME: 'That local time happens twice on that date; pick the slot again to say which one you meant.',
    INVALID_TIMEZONE: 'That time zone is not a resolvable IANA zone.',
    INVALID_PARTY_SIZE: 'Party size must be a positive whole number.',
    INVALID_DURATION: 'Duration must be between 15 and 720 minutes in steps of 15.',
    INVALID_TABLE: 'The request referenced a table the restaurant does not have.',
    TABLE_TOO_SMALL: 'The selected table is too small for that party size.',
    KEY_REUSED: 'That idempotency key was already used for a different request.',
    NOT_FOUND: 'No such booking or restaurant was found.',
    BUSY_RETRY_EXHAUSTED: 'The booking store is busy. Please try again in a moment.',
    INTERNAL: 'The server hit an internal error. Please try again.',
    UNKNOWN_ERROR: 'The server rejected the request.',
    NETWORK_ERROR: 'Could not reach the server. Check the connection and try again.',
    SERVICE_UNAVAILABLE: 'The backend service is unavailable. Please try again later.',
    PENDING: 'Still working on the previous request.',
    MALFORMED_RESPONSE: 'The server returned an unreadable response.',
  };
  return messages[code] ?? defaultMessage ?? 'An error occurred. Please try again.';
}

function errorText(result) {
  const code = result?.error?.code ?? 'UNKNOWN_ERROR';
  const message = getErrorMessage(code, result?.error?.message);
  return `${message} [${code}]`;
}

/**
 * Put a validation message into a form's error region (aria role="alert")
 * and return false so callers can bail out.
 */
function reportFormError(errorElement, message) {
  if (errorElement) {
    errorElement.textContent = message;
  }
  return false;
}

function clearFormError(errorElement) {
  if (errorElement) {
    errorElement.textContent = '';
  }
}

/**
 * Run an async action with the given button marked busy/disabled so a
 * second click cannot fire while the first is in flight.
 */
async function withBusy(button, action) {
  if (pendingAction) return false;
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    await action();
    return true;
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}

/* ------------------------------------------------------------------ *
 * Time zone fold resolution
 *
 * The backend resolves local_start to one UTC instant; when a wall time
 * occurs twice (fall-back) it demands fold 0 (earlier) or 1 (later).
 * The slot the user picked carries its exact start_utc, so the fold is
 * computed here by reproducing the backend's candidate scan.
 * ------------------------------------------------------------------ */

function wallClockAt(ms, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const read = (type) => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? Number.NaN : Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

function findLocalStartCandidates(localStart, timezone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localStart);
  if (match === null) return [];
  const wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const naiveUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const sameWall = (a) =>
    a.year === wall.year &&
    a.month === wall.month &&
    a.day === wall.day &&
    a.hour === wall.hour &&
    a.minute === wall.minute;
  const candidates = new Set();
  // 15-minute scan over a +/-48h offset window, matching the backend.
  for (let offset = -2880; offset <= 2880; offset += 15) {
    const instant = naiveUtc - offset * 60000;
    if (sameWall(wallClockAt(instant, timezone))) candidates.add(instant);
  }
  return [...candidates].sort((a, b) => a - b).map((ms) => new Date(ms).toISOString());
}

/**
 * The fold (0 or 1) that resolves local_start to exactly the picked slot's
 * start_utc, or undefined when it cannot be determined locally.
 */
function computeFold(localStart, timezone, selectedUtc) {
  if (!timezone || !selectedUtc) return undefined;
  const candidates = findLocalStartCandidates(localStart, timezone);
  if (candidates.length < 2) return undefined;
  const index = candidates.indexOf(selectedUtc);
  if (index === 0) return 0;
  if (index > 0) return 1;
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Section: Setup
 * ------------------------------------------------------------------ */

async function handleCreateRestaurant(event) {
  event.preventDefault();

  const name = elements.restaurantName.value.trim();
  const timezone = elements.restaurantTimezone.value;
  clearFormError(elements.restaurantFormError);

  if (name === '' || timezone === '') {
    reportFormError(elements.restaurantFormError, 'Restaurant name and time zone are both required.');
    return;
  }
  if (!VALID_TIMEZONES.includes(timezone)) {
    reportFormError(elements.restaurantFormError, 'Please choose a time zone from the list.');
    return;
  }

  const submitBtn = elements.restaurantForm.querySelector('button[type="submit"]');
  await withBusy(submitBtn, async () => {
    showRestaurantResult('Creating restaurant...', 'loading');
    const result = await apiRequest('/v1/restaurants', {
      method: 'POST',
      body: { name, timezone },
    });
    if (result.ok) {
      currentRestaurant = { id: result.data.id, name, timezone };
      saveContext();
      showRestaurantResult(`Restaurant created with ID ${result.data.id}`, 'success');
      elements.tableSetupCard.style.display = 'block';
      updateContextDisplay();
      elements.restaurantForm.reset();
      showStatus('Restaurant created. Now add tables.', 'success');
    } else {
      showRestaurantResult(errorText(result), 'error');
    }
  });
}

function showRestaurantResult(message, type) {
  if (!elements.restaurantResult) return;
  elements.restaurantResult.innerHTML = `<div class="message ${type}"></div>`;
  elements.restaurantResult.firstChild.textContent = message;
}

async function handleCreateTable(event) {
  event.preventDefault();
  clearFormError(elements.tableFormError);

  if (!currentRestaurant) {
    reportFormError(elements.tableFormError, 'Create a restaurant before adding tables.');
    return;
  }
  const seats = Number(elements.tableSeats.value);
  if (!validatePartySize(seats)) {
    reportFormError(elements.tableFormError, 'Seats must be a positive whole number.');
    return;
  }

  const submitBtn = elements.tableForm.querySelector('button[type="submit"]');
  await withBusy(submitBtn, async () => {
    showTableMessage('Creating table...', 'loading');
    const result = await apiRequest(`/v1/restaurants/${encodeURIComponent(currentRestaurant.id)}/tables`, {
      method: 'POST',
      body: { seats },
    });
    if (result.ok) {
      currentTables.push({ id: result.data.id, seats });
      saveContext();
      showTableMessage(`Table created: ${result.data.id} with ${seats} seats`, 'success');
      updateTablesList();
      updateContextDisplay();
      elements.tableForm.reset();
    } else {
      showTableMessage(errorText(result), 'error');
    }
  });
}

function showTableMessage(message, type) {
  if (!elements.tablesList) return;
  const existing = elements.tablesList.querySelector('.message');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.textContent = message;
  elements.tablesList.prepend(div);
}

function updateTablesList() {
  if (!elements.tablesList) return;
  const existing = elements.tablesList.querySelector('.tables-table');
  if (existing) existing.remove();
  if (currentTables.length === 0) return;

  const table = document.createElement('table');
  table.className = 'tables-table';
  const caption = document.createElement('caption');
  caption.textContent = 'Tables created in this session';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th scope="col">Table ID</th><th scope="col">Seats</th></tr>';
  const tbody = document.createElement('tbody');
  currentTables.forEach((t) => {
    const row = document.createElement('tr');
    const idCell = document.createElement('td');
    idCell.textContent = t.id;
    const seatsCell = document.createElement('td');
    seatsCell.textContent = String(t.seats);
    row.append(idCell, seatsCell);
    tbody.appendChild(row);
  });
  table.append(caption, thead, tbody);
  elements.tablesList.appendChild(table);
}

async function handleQuickDemo() {
  if (!elements.quickDemoResult) return;

  await withBusy(elements.quickDemoBtn, async () => {
    elements.quickDemoResult.innerHTML = '<div class="message loading"></div>';
    elements.quickDemoResult.firstChild.textContent = 'Running quick demo setup...';

    const fail = (step, result) => {
      elements.quickDemoResult.innerHTML = '<div class="message error"></div>';
      elements.quickDemoResult.firstChild.textContent = `${step}: ${errorText(result)}`;
    };

    // Step 1 of 3: the restaurant.
    const restaurantResult = await apiRequest('/v1/restaurants', {
      method: 'POST',
      body: { name: 'Demo Restaurant', timezone: 'America/New_York' },
    });
    if (!restaurantResult.ok) {
      fail('Failed to create restaurant', restaurantResult);
      return;
    }
    currentRestaurant = {
      id: restaurantResult.data.id,
      name: 'Demo Restaurant',
      timezone: 'America/New_York',
    };

    // Step 2 of 3: a two-seat table.
    const table1Result = await apiRequest(
      `/v1/restaurants/${encodeURIComponent(currentRestaurant.id)}/tables`,
      { method: 'POST', body: { seats: 2 } },
    );
    if (!table1Result.ok) {
      saveContext();
      fail(`Restaurant ${currentRestaurant.id} was created, but table 1 failed`, table1Result);
      return;
    }
    currentTables.push({ id: table1Result.data.id, seats: 2 });

    // Step 3 of 3: a four-seat table.
    const table2Result = await apiRequest(
      `/v1/restaurants/${encodeURIComponent(currentRestaurant.id)}/tables`,
      { method: 'POST', body: { seats: 4 } },
    );
    if (!table2Result.ok) {
      saveContext();
      fail(`Restaurant and table 1 were created, but table 2 failed`, table2Result);
      return;
    }
    currentTables.push({ id: table2Result.data.id, seats: 4 });

    saveContext();

    elements.quickDemoResult.innerHTML = [
      '<div class="message success">',
      '<strong>Quick demo setup complete.</strong>',
      '<ul>',
      `<li>Restaurant: <span id="demo-restaurant-id">${escapeHtml(currentRestaurant.id)}</span> (${escapeHtml(currentRestaurant.name)})</li>`,
      `<li>Table 1: ${escapeHtml(table1Result.data.id)} - 2 seats</li>`,
      `<li>Table 2: ${escapeHtml(table2Result.data.id)} - 4 seats</li>`,
      '</ul>',
      '</div>',
    ].join('');

    elements.tableSetupCard.style.display = 'block';
    updateTablesList();
    updateContextDisplay();
    elements.searchRestaurantId.value = currentRestaurant.id;
    showStatus('Quick demo setup finished. Search tab is ready.', 'success');
  });
}

/* ------------------------------------------------------------------ *
 * Section: Search
 * ------------------------------------------------------------------ */

async function handleSearch(event) {
  event.preventDefault();
  clearFormError(elements.searchFormError);

  const restaurantId = elements.searchRestaurantId.value.trim();
  const localDate = elements.searchDate.value;
  const partySize = Number(elements.searchPartySize.value);
  const durationMin = Number(elements.searchDuration.value);

  if (restaurantId === '') {
    reportFormError(elements.searchFormError, 'Restaurant ID is required.');
    return;
  }
  if (!validateDate(localDate)) {
    reportFormError(elements.searchFormError, 'Date must be a real calendar date in YYYY-MM-DD form.');
    return;
  }
  if (!validatePartySize(partySize)) {
    reportFormError(elements.searchFormError, 'Party size must be a positive whole number.');
    return;
  }
  if (!validateDuration(durationMin)) {
    reportFormError(elements.searchFormError, 'Duration must be 15 to 720 minutes in steps of 15.');
    return;
  }

  await withBusy(elements.searchBtn, async () => {
    showSearchResults('Searching for availability...', 'loading');
    const url =
      `/v1/restaurants/${encodeURIComponent(restaurantId)}/availability` +
      `?local_date=${encodeURIComponent(localDate)}` +
      `&party_size=${encodeURIComponent(String(partySize))}` +
      `&duration_min=${encodeURIComponent(String(durationMin))}`;
    const result = await apiRequest(url, { method: 'GET' });
    if (result.ok) {
      renderAvailabilityResults(result.data?.slots, restaurantId, partySize, durationMin);
    } else {
      showSearchResults(errorText(result), 'error');
    }
  });
}

function renderAvailabilityResults(slots, restaurantId, partySize, durationMin) {
  if (!elements.searchResults) return;

  if (!Array.isArray(slots)) {
    showSearchResults('The server response did not include a slot list. [MALFORMED_RESPONSE]', 'error');
    return;
  }
  if (slots.length === 0) {
    elements.searchResults.innerHTML = `
      <div class="card">
        <h3>Available slots</h3>
        <p class="empty-state" id="slots-empty">No slots match that restaurant, date, party size, and duration.</p>
      </div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'card';
  const heading = document.createElement('h3');
  heading.textContent = `Available slots (${slots.length} found)`;
  const slotsWrap = document.createElement('div');
  slotsWrap.className = 'slots-list';
  slotsWrap.setAttribute('role', 'list');

  slots.forEach((slot, index) => {
    const card = document.createElement('div');
    card.className = 'slot-card';
    card.setAttribute('role', 'listitem');

    const time = document.createElement('div');
    time.className = 'slot-time';
    const strong = document.createElement('strong');
    strong.textContent = slot.start_local;
    const utc = document.createElement('span');
    utc.className = 'slot-utc';
    utc.textContent = `UTC: ${slot.start_utc}`;
    time.append(strong, utc);

    const tables = document.createElement('div');
    tables.className = 'slot-tables';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Available tables: ';
    const ids = document.createElement('span');
    ids.className = 'table-ids';
    ids.textContent = Array.isArray(slot.table_ids) ? slot.table_ids.join(', ') : '';
    tables.append(label, ids);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary select-slot-btn';
    btn.dataset.index = String(index);
    btn.dataset.restaurant = restaurantId;
    btn.dataset.localStart = slot.start_local;
    btn.dataset.utcStart = slot.start_utc;
    btn.dataset.tables = JSON.stringify(slot.table_ids ?? []);
    btn.dataset.partySize = String(partySize);
    btn.dataset.duration = String(durationMin);
    btn.textContent = 'Select this slot';
    btn.setAttribute('aria-label', `Select slot ${slot.start_local} UTC ${slot.start_utc}`);
    btn.addEventListener('click', onSelectSlot);

    card.append(time, tables, btn);
    slotsWrap.appendChild(card);
  });

  list.append(heading, slotsWrap);
  elements.searchResults.innerHTML = '';
  elements.searchResults.appendChild(list);
}

function onSelectSlot(event) {
  const btn = event.currentTarget;
  selectedSlot = {
    restaurantId: btn.dataset.restaurant,
    localStart: btn.dataset.localStart,
    utcStart: btn.dataset.utcStart,
    tableIds: JSON.parse(btn.dataset.tables),
    partySize: Number(btn.dataset.partySize),
    durationMin: Number(btn.dataset.duration),
  };
  showBookingConfirmation();
  showSection('book');
  elements.confirmBookingBtn?.focus();
}

function showSearchResults(message, type) {
  if (!elements.searchResults) return;
  elements.searchResults.innerHTML = `<div class="message ${type}"></div>`;
  elements.searchResults.firstChild.textContent = message;
}

/* ------------------------------------------------------------------ *
 * Section: Book
 * ------------------------------------------------------------------ */

function showBookingConfirmation() {
  if (!selectedSlot) {
    if (elements.bookingSummary) {
      elements.bookingSummary.innerHTML = '<p class="empty-state">Pick a time slot on the Search tab first.</p>';
    }
    if (elements.bookingForm) elements.bookingForm.style.display = 'none';
    return;
  }
  elements.confirmRestaurantId.textContent = selectedSlot.restaurantId;
  elements.confirmTableIds.textContent = selectedSlot.tableIds.join(', ');
  elements.confirmPartySize.textContent = String(selectedSlot.partySize);
  elements.confirmLocalStart.textContent = `${selectedSlot.localStart} (UTC: ${selectedSlot.utcStart})`;
  elements.confirmDuration.textContent = `${selectedSlot.durationMin} minutes`;
  if (elements.bookingSummary) elements.bookingSummary.innerHTML = '';
  if (elements.bookingForm) elements.bookingForm.style.display = 'block';
}

function clearBookingForm() {
  selectedSlot = null;
  if (elements.bookingSummary) {
    elements.bookingSummary.innerHTML = '<p class="empty-state">Pick a time slot on the Search tab first.</p>';
  }
  if (elements.bookingForm) elements.bookingForm.style.display = 'none';
}

async function handleConfirmBooking(event) {
  event.preventDefault();
  if (!selectedSlot) {
    showBookingResult('Pick a time slot on the Search tab first.', 'error');
    return;
  }

  const timezone = currentRestaurant?.timezone;
  const fold = computeFold(selectedSlot.localStart, timezone, selectedSlot.utcStart);
  const body = {
    restaurant_id: selectedSlot.restaurantId,
    table_ids: selectedSlot.tableIds,
    party_size: selectedSlot.partySize,
    local_start: selectedSlot.localStart,
    duration_min: selectedSlot.durationMin,
    idempotency_key: undefined,
    // null means "not specified": the backend resolves an unambiguous wall time
    // and answers AMBIGUOUS_LOCAL_TIME for an ambiguous one instead of guessing.
    fold: fold ?? null,
  };

  // One logical attempt = one idempotency key. The key survives a retry of
  // the identical request after a network failure (uncertain outcome); any
  // server answer, successful or not, closes the attempt.
  const fingerprint = JSON.stringify({ ...body, idempotency_key: undefined });
  if (pendingBookingAttempt === null || pendingBookingAttempt.fingerprint !== fingerprint) {
    pendingBookingAttempt = { fingerprint, key: generateIdempotencyKey() };
  }
  body.idempotency_key = pendingBookingAttempt.key;

  await withBusy(elements.confirmBookingBtn, async () => {
    showBookingResult('Creating booking...', 'loading');
    const result = await apiRequest('/v1/bookings', { method: 'POST', body });

    if (result.status > 0) {
      // The server answered: this attempt is settled either way.
      pendingBookingAttempt = null;
    }

    if (result.ok) {
      currentBooking = result.data;
      saveContext();
      renderBookingSuccess(result);
      updateContextDisplay();
      showStatus('Booking created.', 'success');
      return;
    }

    // Ambiguous wall time with a fold we could not compute locally: retry
    // once with the fold that matches the slot the user actually picked.
    const candidates = result.error?.details?.candidates;
    if (
      result.error?.code === 'AMBIGUOUS_LOCAL_TIME' &&
      Array.isArray(candidates) &&
      selectedSlot.utcStart &&
      candidates.includes(selectedSlot.utcStart)
    ) {
      pendingBookingAttempt = { fingerprint, key: generateIdempotencyKey() };
      body.fold = candidates.indexOf(selectedSlot.utcStart);
      body.idempotency_key = pendingBookingAttempt.key;
      const retry = await apiRequest('/v1/bookings', { method: 'POST', body });
      if (retry.status > 0) pendingBookingAttempt = null;
      if (retry.ok) {
        currentBooking = retry.data;
        saveContext();
        renderBookingSuccess(retry);
        updateContextDisplay();
        showStatus('Booking created.', 'success');
        return;
      }
      showBookingResult(errorText(retry), 'error');
      return;
    }

    showBookingResult(errorText(result), 'error');
  });
}

function renderBookingSuccess(result) {
  const booking = result.data;
  const headline = result.status === 201
    ? 'New booking created.'
    : 'Server already had this booking (replayed request).';

  elements.bookingResult.innerHTML = [
    '<div class="message success" id="booking-success">',
    `<strong>${escapeHtml(headline)}</strong>`,
    '<dl class="detail-list">',
    '<dt>Booking ID:</dt>',
    `<dd id="new-booking-id">${escapeHtml(booking.id)}</dd>`,
    '<dt>Restaurant:</dt>',
    `<dd>${escapeHtml(booking.restaurant_id)}</dd>`,
    '<dt>Time (UTC):</dt>',
    `<dd>${escapeHtml(booking.start_utc)}</dd>`,
    '<dt>Party size:</dt>',
    `<dd>${booking.party_size}</dd>`,
    '<dt>Duration:</dt>',
    `<dd>${booking.duration_min} minutes</dd>`,
    '<dt>Status:</dt>',
    `<dd>${escapeHtml(booking.status)}</dd>`,
    '</dl>',
    '<button type="button" class="btn btn-primary go-manage-btn">Go to Manage tab</button>',
    '</div>',
  ].join('');

  if (elements.bookingForm) elements.bookingForm.style.display = 'none';
  elements.bookingResult.querySelector('.go-manage-btn')?.addEventListener('click', () => {
    if (currentBooking) elements.manageBookingId.value = currentBooking.id;
    showSection('manage');
    elements.retrieveBookingBtn?.focus();
  });
}

function showBookingResult(message, type) {
  if (!elements.bookingResult) return;
  elements.bookingResult.innerHTML = `<div class="message ${type}"></div>`;
  elements.bookingResult.firstChild.textContent = message;
}

/* ------------------------------------------------------------------ *
 * Section: Manage and cancel
 * ------------------------------------------------------------------ */

async function handleRetrieveBooking(event) {
  event.preventDefault();
  clearFormError(elements.manageFormError);

  const bookingId = elements.manageBookingId.value.trim();
  if (bookingId === '') {
    reportFormError(elements.manageFormError, 'Booking ID is required.');
    return;
  }

  await withBusy(elements.retrieveBookingBtn, async () => {
    showBookingDetails('Retrieving booking...', 'loading');
    hideCancelSection();
    const result = await apiRequest(`/v1/bookings/${encodeURIComponent(bookingId)}`, { method: 'GET' });
    if (result.ok) {
      currentBooking = result.data;
      saveContext();
      renderBookingDetails(result.data);
      showCancelSection();
      updateContextDisplay();
    } else {
      showBookingDetails(errorText(result), 'error');
      hideCancelSection();
    }
  });
}

function renderBookingDetails(booking) {
  if (!elements.bookingDetails) return;
  elements.bookingDetails.innerHTML = [
    '<div class="card">',
    '<h3>Booking details</h3>',
    '<dl class="detail-list">',
    '<dt>Booking ID:</dt>',
    `<dd id="detail-booking-id">${escapeHtml(booking.id)}</dd>`,
    '<dt>Restaurant ID:</dt>',
    `<dd>${escapeHtml(booking.restaurant_id)}</dd>`,
    '<dt>Party size:</dt>',
    `<dd>${booking.party_size}</dd>`,
    '<dt>Start (UTC):</dt>',
    `<dd>${escapeHtml(booking.start_utc)}</dd>`,
    '<dt>Duration:</dt>',
    `<dd>${booking.duration_min} minutes</dd>`,
    '<dt>Status:</dt>',
    `<dd><span class="status-badge ${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span></dd>`,
    '<dt>Created (UTC):</dt>',
    `<dd>${escapeHtml(booking.created_at_utc)}</dd>`,
    '</dl>',
    '</div>',
  ].join('');
}

function showBookingDetails(message, type) {
  if (!elements.bookingDetails) return;
  elements.bookingDetails.innerHTML = `<div class="message ${type}"></div>`;
  elements.bookingDetails.firstChild.textContent = message;
}

function showCancelSection() {
  if (elements.cancelSection) elements.cancelSection.style.display = 'block';
}

function hideCancelSection() {
  if (elements.cancelSection) elements.cancelSection.style.display = 'none';
}

async function handleCancelBooking() {
  if (!currentBooking) {
    showBookingDetails('Load a booking before cancelling one.', 'error');
    return;
  }
  const bookingId = currentBooking.id;

  hideCancelSection();
  showBookingDetails('Cancelling booking...', 'loading');

  const result = await apiRequest(`/v1/bookings/${encodeURIComponent(bookingId)}`, { method: 'DELETE' });

  if (result.ok) {
    currentBooking = null;
    saveContext();
    showBookingDetails(
      `Booking ${bookingId} was cancelled. The booking is no longer active.`,
      'success',
    );
    updateContextDisplay();
    showStatus('Booking cancelled.', 'success');
  } else {
    showBookingDetails(`${bookingId}: ${errorText(result)}`, 'error');
    // Keep the confirmation block visible so the user can retry.
    showCancelSection();
  }
}

/* ------------------------------------------------------------------ *
 * Context (sessionStorage convenience state; no secrets)
 * ------------------------------------------------------------------ */

function updateContextDisplay() {
  if (!elements.contextSummary) return;
  const hasContext = currentRestaurant !== null || currentTables.length > 0 || currentBooking !== null;

  if (hasContext) {
    elements.contextSummary.style.display = 'block';
    elements.contextRestaurant.textContent = currentRestaurant
      ? `${currentRestaurant.name} (${currentRestaurant.id})`
      : 'None';
    elements.contextTables.textContent =
      currentTables.length > 0
        ? currentTables.map((t) => `${t.id} - ${t.seats} seats`).join(', ')
        : 'None';
    if (currentRestaurant) {
      elements.tableSetupCard.style.display = 'block';
      updateTablesList();
    }
  } else {
    elements.contextSummary.style.display = 'none';
    elements.tableSetupCard.style.display = 'none';
  }
}

function saveContext() {
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        restaurant: currentRestaurant,
        tables: currentTables,
        booking: currentBooking,
        latest_booking_id: currentBooking?.id ?? null,
      }),
    );
  } catch {
    // Storage may be full or blocked; context is a convenience only.
  }
}

function loadContext() {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      const context = JSON.parse(stored);
      currentRestaurant = context.restaurant ?? null;
      currentTables = Array.isArray(context.tables) ? context.tables : [];
      currentBooking = context.booking ?? null;
    }
  } catch {
    // A corrupt stored value is treated as no context.
  }
}

function clearContext() {
  currentRestaurant = null;
  currentTables = [];
  currentBooking = null;
  selectedSlot = null;
  pendingBookingAttempt = null;
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
  updateContextDisplay();
  clearBookingForm();
  if (elements.searchRestaurantId) elements.searchRestaurantId.value = '';
  if (elements.manageBookingId) elements.manageBookingId.value = '';
  showStatus('Context cleared.', 'info');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
