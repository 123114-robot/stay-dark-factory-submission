# Stage 4 Task — Product surface and delivery

**Frozen Scope**: This file is the complete scope for Stage 4. Do not add features.

## 1. Scope Boundaries

### Allowed Additions/Modifications
- `stage-4/TASK.md` (this file)
- `stage-4/README.md`
- `stage-4/package.json`
- `stage-4/package-lock.json` (if created by npm install)
- `stage-4/Dockerfile`
- `stage-4/RUN.md`
- `stage-4/frontend/index.html`
- `stage-4/frontend/app.js`
- `stage-4/frontend/styles.css` (exact plural filename, used consistently in HTML, server, tests, Docker, docs)
- `stage-4/frontend/serve.mjs` (static server and proxy)
- `stage-4/deploy/start.mjs` (process composition)
- `stage-4/test/**` (test files, any extension — mirrors the owner's allowed list)
- minimal Stage 4-only supporting files required by the chosen implementation (mirrors the owner's allowed list; e.g. `stage-4/deploy/demo.mjs` per ruling R3 below)

### Forbidden Modifications
- Every file under `stage-1/`, `stage-2/`, `stage-3/`
- `mandates/**`, `plan.md`, `architecture.json`, `FACTORY.md`
- Database schema or migrations
- Root files not explicitly assigned

## 2. Required Architecture

### Data Flow
```
Browser
  -> HTTP port 8080
  -> Stage 4 static server and same-origin proxy
     -> static HTML/CSS/JavaScript for browser routes
     -> proxy `/health` and existing `/v1/*` API requests
  -> existing backend service internally on port 3000
  -> existing SQLite database and booking logic
```

### Proxy Requirements
- Browser calls relative same-origin paths only
- Default internal backend: `http://127.0.0.1:3000`
- Backend origin configurable via `BACKEND_URL` environment variable
- Preserves HTTP method, path, query string, request body, necessary headers
- Preserves backend status code, content type, response body
- Backend unavailable: deterministic JSON error, appropriate 5xx status, no crash
- No booking/availability/persistence logic in proxy

### Container Requirements
- Build from pinned Node image
- Install only required dependencies
- Copy only required application files
- Start backend internally on 3000
- Start Stage 4 server/proxy on 8080
- Expose 8080 only
- No CDN or runtime internet dependency
- Terminate clearly if required process fails

## 3. UI Product Flow

### 3.1 Global Application Shell
- Product name: "Tablekeeper"
- Purpose: Restaurant reservation management
- Navigation/progress for Setup, Search, Book, Manage
- Backend connection state: checking, connected, unavailable
- Current restaurant context when available
- One aria-live status region for async results
- No API keys, credentials, stack traces, or DB paths in browser output

### 3.2 Restaurant and Table Setup
- Create restaurant: name + IANA time zone (dropdown with: Australia/Sydney, America/New_York, Europe/London, Asia/Kathmandu, Australia/Eucla, Pacific/Chatham)
- Create at least two tables: positive integer capacities
- Quick Demo Setup action: creates one restaurant + two tables using valid API requests
- Hours limitation (owner Part 6, ruling R3): stages 1–3 expose no HTTP endpoint for setting
  `restaurant_hours`, and none may be invented. Hours fixture preparation is done ONLY by the
  Stage 4 composition layer (`deploy/demo.mjs`, injected into `serve.mjs` by `deploy/start.mjs`).
  `serve.mjs` itself must contain no SQL and no database imports. The limitation must be
  documented in README and RUN.md.
- Display created identifiers and capacities
- Auto-carry active restaurant into Search
- Prevent duplicate submits while pending
- Session storage: non-secret convenience state (current restaurant ID, table IDs, latest booking ID)

### 3.3 Availability Search
- Fields: restaurant ID, local date (YYYY-MM-DD), party size, duration minutes
- Validation: required values, party size positive integer, duration positive ≤720 and divisible by 15
- Request: `GET /v1/restaurants/:id/availability?local_date&party_size&duration_min`
- Render: local start, UTC start, table IDs for every result
- Select action per slot that carries to booking confirmation
- States: loading, empty, success, validation error, API error, malformed response, backend unavailable

### 3.4 Booking Confirmation and Creation
- Confirmation summary: restaurant ID, table IDs, party size, local start, duration
- Explicit confirm before POST
- Generate fresh UUID idempotency value per logical attempt
- Reuse idempotency key only when retrying identical request after uncertain transport outcome
- Request body: `{restaurant_id, table_ids, party_size, local_start, duration_min, idempotency_key, fold}`
- Distinguish HTTP 201 (new) from HTTP 200 (replay)
- Success display: booking ID, restaurant, time, party size, duration, status
- Auto-carry booking ID into Manage

### 3.5 Manage Booking
- Input: booking ID (prefill with most recently created)
- Retrieve: `GET /v1/bookings/:id`
- Render: all BookingView fields (id, restaurant_id, party_size, start_utc, duration_min, status, created_at_utc)
- States: loading, success, NOT_FOUND, malformed response, unavailable

### 3.6 Cancellation
- Available only after booking successfully loaded
- In-page confirmation state (not just window.confirm)
- Request: `DELETE /v1/bookings/:id`
- Treat HTTP 204 as success
- Clear or mark inactive displayed booking after success
- Repeated cancellation visibly reports backend's NOT_FOUND

### 3.7 Error Mapping
Parse error envelope and display friendly explanation + original backend code:
- SLOT_TAKEN, INVALID_TIME, INVALID_DURATION, INVALID_TABLE, TABLE_TOO_SMALL
- KEY_REUSED, NOT_FOUND, rate limiting (if wired), malformed response
- Timeout/network error, backend startup failure

Never transform error into success state.

### 3.8 Accessibility and Responsive Behavior
- Every input has programmatic label and error association
- All actions keyboard operable
- Visible focus styles intact
- State not communicated by color alone
- Loading controls disabled with busy state
- Semantic headings, buttons, forms, status messaging
- Below ~640px: single readable column, no horizontal overflow
- Primary actions reachable without hover
- Sufficient text/background contrast

## 4. TDD Implementation Units (in order)

Do not start Unit N+1 until Unit N's targeted tests are GREEN.

### Unit 1 — Server/Proxy Contract
RED tests:
- Serves index.html with correct content-type
- Serves JS and CSS with correct content-types
- Forwards method/path/query/body to fake backend
- Preserves backend success/error statuses/bodies
- Converts backend-unavailable to deterministic 5xx JSON
- Blocks traversal, no arbitrary file exposure

GREEN: Minimal static server and proxy

### Unit 2 — UI API Client and State
RED tests:
- Handles JSON success, 204 success, error envelope, malformed response, network failure
- Submit actions cannot double-fire while pending
- Latest restaurant/booking context carried forward

GREEN: Minimal browser request/state code

### Unit 3 — Setup and Quick Demo Flow
RED test:
- Creates restaurant and tables in order
- Stops and reports exact failed step on partial failure
- Successful setup fills search context

GREEN: Setup UI and orchestration

### Unit 4 — Availability Flow
RED tests:
- Validates date, party size, duration
- Encodes query correctly
- Renders multiple, empty, error results
- Selected slot fills booking confirmation

GREEN: Search form and result rendering

### Unit 5 — Booking Flow
RED tests:
- Sends exact body
- Appropriate idempotency behavior
- Distinguishes 201 from 200
- Displays SLOT_TAKEN and other errors
- Success fills Manage context

GREEN: Confirmation and booking behavior

### Unit 6 — Manage and Cancellation Flow
RED tests:
- Loads and renders booking
- Handles NOT_FOUND
- Requires in-page cancel confirmation
- Treats 204 as success
- Repeated cancellation reports NOT_FOUND

GREEN: Manage and cancel behavior

### Unit 7 — Responsive/Accessibility
RED checks:
- Accessible names, labels, keyboard reachability
- Visible status semantics
- Narrow viewport has no horizontal overflow

GREEN: Semantic and responsive adjustments

### Unit 8 — Process Composition and Docker
RED smoke checks:
- Clean startup creates both processes
- Required child failure produces non-zero exit
- SIGTERM shuts down children
- Port 8080 ready

GREEN: Process supervisor, Dockerfile, RUN.md

### Unit 9 — Playwright E2E
Write test before finalizing integration. Use disposable database.

Required scenarios:
1. Happy path: Quick Demo Setup → availability → select slot → confirm booking → display booking → retrieve → cancel → success
2. Double booking: First booking succeeds → overlapping gets SLOT_TAKEN
3. Invalid duration: non-15-min duration → visible refusal, no invalid booking
4. Backend unavailable: UI exposes unavailable state without crashing or false success
5. Mobile viewport: essential journey usable, no horizontal overflow

## 5. Acceptance Gates (run in order)

### Gate 1 — Repository Boundary
- [ ] Branch is `feature/stage-4-ui`
- [ ] Final diff contains only allowed Stage 4 paths
- [ ] Stage 1–3 have no changes (`git diff stage-1/ stage-2/ stage-3/` empty)

### Gate 2 — Stage 4 Targeted Tests
- [ ] Proxy/static server tests pass
- [ ] Browser logic/component tests pass (if used)
- [ ] Process composition tests pass (if used)
- [ ] No-env boot regression test: server started with only `PORT` set (no `FRONTEND_DIR`)
      serves `/index.html` 200 and proxies `/health` (ruling R1)
- [ ] Traversal coverage that can actually fail: a raw-HTTP-path integration test plus a direct
      unit test of the exported path resolver with hostile pathnames (ruling R5)
- [ ] Production-artifact persistence check before and after tests: `index.html`, `app.js`,
      `styles.css` exist at canonical paths, are not fixture stubs, and remain visible to Git

Commands:
```bash
cd C:\Users\deba3\band-work\result\stage-4
npm test
```

### Gate 3 — Type/Syntax/Lint Checks
- [ ] Use scripts that exist after Stage 4 setup
- [ ] Do not report missing scripts as passing

Commands:
```bash
cd C:\Users\deba3\band-work\result\stage-4
npm run typecheck  # if defined in package.json
```

### Gate 4 — Playwright E2E
- [ ] All 5 required scenarios pass
- [ ] Scenario 1 starts by clicking **Quick Demo Setup** in the UI and completes the full
      journey from that button (owner §7 Unit 9; ruling R3). The harness must NOT seed a
      restaurant or write `restaurant_hours` rows directly — restaurants for every scenario
      come from Quick Demo (or the same composition-layer fixture path it exercises).
- [ ] Report exact passed/failed/skipped counts

Commands:
```bash
cd C:\Users\deba3\band-work\result\stage-4
npm run test:e2e  # or equivalent Playwright command
```

### Gate 5 — Frozen-Stage Regression
- [ ] Stage 1 tests pass
- [ ] Stage 2 tests pass
- [ ] Stage 3 tests pass
- [ ] Do not edit Stage 1–3 to make failures disappear

Commands:
```bash
cd C:\Users\deba3\band-work\result\stage-1
npm test

cd C:\Users\deba3\band-work\result\stage-2
npm test

cd C:\Users\deba3\band-work\result\stage-3
npm test
```

### Gate 6 — Docker/Isolated Smoke
- [ ] Build Stage 4 image
- [ ] Start with disposable state
- [ ] Verify port 8080 and browser/API journey
- [ ] Stop cleanly

Commands (build context must be the repository root, because the Dockerfile
copies stage-1/..stage-4/; run from the repository root):
```bash
cd C:\Users\deba3\band-work\result
docker build -f stage-4/Dockerfile -t tablekeeper-stage4 .
docker run --rm -p 8080:8080 -e DATABASE_PATH=:memory: tablekeeper-stage4
# In another terminal, verify:
curl http://localhost:8080/health
```

If Docker unavailable: state as UNVERIFIED.

### Gate 7 — Secret and Artifact Check
- [ ] Inspect tracked/staged Stage 4 files for secrets
- [ ] No API keys, bearer tokens, credentials, private keys
- [ ] No local database files, logs, screenshots with secrets
- [ ] No dependency folders or build output in git

Command:
```bash
cd C:\Users\deba3\band-work\result
git diff --cached --name-only
git diff --name-only
# Inspect each file for secrets before commit
```

### Gate 8 — Final Diff Review
- [ ] `git diff --check` clean
- [ ] Inspect complete Stage 4 diff
- [ ] Confirm no unintended file or behavior changes

## 6. Handoff Protocol

### From Planner to Implementer
- Planner publishes this TASK.md
- Planner explicitly @mentions Implementer
- Implementer replies acknowledging task receipt
- Implementer runs RED tests before writing code

### From Implementer to Reviewer
- Implementer confirms all acceptance gates pass
- Implementer provides:
  - Exact file paths
  - Commands run and their output
  - Any test modifications with justification
- Implementer explicitly @mentions Reviewer

### From Reviewer to Planner
- Reviewer independently reruns acceptance commands
- Reviewer inspects complete diff
- Reviewer separates blocking defects from preferences
- Reviewer provides PASS / FAIL / UNVERIFIED verdict with evidence
- Reviewer explicitly @mentions Planner

## 7. Commit Protocol

Only after Reviewer gives no-blocker verdict:
1. Run `git status --short` and confirm intended scope
2. Stage only allowed Stage 4 files
3. Inspect staged diff and file list
4. Create one local commit with message: `feat(stage-4): add reservation UI and delivery package`
5. Do not push and do not merge
6. Record produced commit SHA

## 8. Final Receipt Requirements

The final room report must contain:
- Branch name, starting SHA, final local commit SHA
- Architecture/data-flow summary
- Files added or modified
- Exact tests and commands executed
- pass/fail/skipped counts
- Docker result, Playwright result, Stage 1–3 regression result
- Secret-scan result
- Reviewer issues found and resolutions
- Remaining risks and every UNVERIFIED item
- Confirmation Stage 1–3 not modified
- Confirmation nothing pushed or merged

Machine-readable receipt:
```
STAGE4_RECEIPT
branch: feature/stage-4-ui
start_sha: <sha>
commit_sha: <sha-or-NONE>
scope_ok: PASS|FAIL
stage4_tests: PASS|FAIL|UNVERIFIED
playwright: PASS|FAIL|UNVERIFIED
docker: PASS|FAIL|UNVERIFIED
stage1_regression: PASS|FAIL|UNVERIFIED
stage2_regression: PASS|FAIL|UNVERIFIED
stage3_regression: PASS|FAIL|UNVERIFIED
secret_check: PASS|FAIL|UNVERIFIED
review: PASS|FAIL
unverified: <comma-separated or NONE>
push_performed: NO
merge_performed: NO
```

## 9. Planner Rulings — Fix Round 1 (2026-10-05)

Issued after the Reviewer's FAIL verdict on commit `d696013`. All three blockers were
independently reproduced by the Planner against the committed tree. These rulings are
in scope of the owner's seven-part Stage 4 instruction (parts 3, 6, 7, 8, 9); they do
not reopen any owner decision.

### R1 — BLOCKING 1, standalone server 404s on Windows (CONFIRMED, reproduced live)
`serve.mjs:214` derives `frontendDir` with `new URL('.', import.meta.url).pathname`
(→ `/C:/…` on Windows), so the `startsWith` guard rejects every path.
- Fix: `fileURLToPath(new URL('.', import.meta.url))` (the import already exists).
- Regression test REQUIRED: start the server with only `PORT` set (no `FRONTEND_DIR`),
  assert `GET /index.html` → 200 and `GET /health` proxies correctly. This test must
  fail before the fix.

### R2 — BLOCKING 2, Unit 2 tests dead code (CONFIRMED)
`api-client.mjs` is loaded by no shipped code; `app.js` implements its own helper;
README:39 claims otherwise; the shipped malformed path (`app.js:677-680`) has no test.
- Decision: **delete `frontend/api-client.mjs`**. Port all Unit 2 coverage (JSON success,
  204, error envelope, malformed response, network failure, double-submit guard, context
  carry-forward) to jsdom tests that exercise the canonical `app.js` through the existing
  `test/helpers/ui.mjs` harness and `startStubBackend` (malformed/forced-failure routes).
- The malformed-response test must drive `app.js:677-680` (availability response with a
  non-array `slots`) to the visible `[MALFORMED_RESPONSE]` state.
- Correct `README.md:39` to describe `app.js` as the shipped request helper; update the
  `test:unit` script in `package.json`; remove every remaining `api-client` reference.

### R3 — BLOCKING 3, Quick Demo cannot reach availability (owner pre-ruled, Part 6)
No stage exposes an hours endpoint; a UI-created restaurant fail-closes to zero slots.
Owner authorization: composition-layer fixture preparation only, documented, normal
browser requests stay on the existing `/v1/*` contract. Mechanism (fixed, not optional):
- New `stage-4/deploy/demo.mjs`: `seedDefaultHours(restaurantId, dbPath)` — opens the DB
  with `node:sqlite`, applies Stage 2's exported `migrate2` (via the existing Stage 1/2
  imports, read-only, no frozen file changes), then `INSERT OR REPLACE` for weekdays 0–6,
  06:00–23:00 local wall-clock minutes. **All SQL lives here, in `deploy/`.**
- `serve.mjs` gains ONE optional injected async hook: `options.onRestaurantCreated(id)`.
  After a buffered `201` response from proxied `POST /v1/restaurants`, parse `{id}` from
  the response copy, `await` the hook, then forward the response unchanged. Hook errors
  are logged; the backend's 201 is still forwarded (never fabricated as failure).
  `serve.mjs` must contain no SQL and no database imports. Hook absent (standalone run) =
  no fixture preparation, which is documented behavior.
- `deploy/start.mjs` injects `onRestaurantCreated: (id) => seedDefaultHours(id, DATABASE_PATH)`.
- Document the limitation in README and RUN.md (hours have no API; the composition layer
  seeds default hours for restaurants created while it runs; restaurants created outside
  this composition show no availability until hours exist).
- Quick Demo keeps its current browser requests (`POST /v1/restaurants`, two
  `POST /v1/restaurants/:id/tables`) — no new browser endpoint, no `/v1` hours route.
- E2E scenario 1 must click the real Quick Demo button and complete
  search → select → confirm → display → retrieve → cancel. Remove the direct
  `restaurant_hours` INSERT from `test/e2e/harness.mjs`; all E2E restaurants come from
  Quick Demo (or that same composition path). Unit tests may continue seeding disposable
  test databases directly (they are unit fixtures, not product evidence).

### R4 — hardcoded fixture path
`test/server.test.mjs:17` must use `mkdtemp(join(tmpdir(), 'stage4-test-'))` instead of
the account-specific path. The suite must pass for any user on any machine.

### R5 — traversal tests that cannot fail
- Extract the static-path resolution from `serve.mjs` into an exported, unit-testable
  function; unit-test it directly with hostile pathnames (`/../plan.md`,
  encoded forms, malformed `frontendDir`) asserting escape is rejected.
- Add a raw-HTTP integration test using `node:http` with an un-normalized request path
  asserting foreign content is never returned (the URL parser currently normalizes
  `fetch()` paths before the guard is reached — that is why the mutation survived).

### R6 — RUN.md contract gaps (owner Part 8)
- RUN.md MUST gain backup/restore guidance grounded in the existing SQLite design
  (WAL: copy the `.db` with its `-wal`/`-shm` siblings or use SQLite backup semantics;
  only commands actually executed may be documented — otherwise mark UNVERIFIED).
- Migration-application documentation: the owner's Part 8 RUN.md list does not include
  it; the placeholder README's commitment is superseded. Drop is intended — do not add.

### Fix round order
R1–R5 are code/test fixes → run the full acceptance gate list (§5, in order) →
re-handoff to @deba37f95/reviewer with exact commands and output. R6 is part of the
same handoff. No commit is created until the Reviewer returns a no-blocker verdict.
