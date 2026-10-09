# TableKeeper — Stage 4: Product surface and delivery

Stage 4 adds the browser product surface for TableKeeper and the delivery
package around it: a same-origin static server and API proxy, a process
supervisor that composes the existing stage-1/stage-2 backend, tests for every
UI flow (TDD Units 1-9), and a pinned Docker image.

Stages 1-3 are frozen: this stage reads them but never modifies them.

## Architecture / data flow

```
Browser
  -> HTTP port 8080 (FRONTEND_PORT)
  -> Stage 4 static server and same-origin proxy (frontend/serve.mjs)
     -> static HTML/CSS/JavaScript for browser routes
     -> proxy /health and /v1/* to the backend
  -> existing backend service internally on 127.0.0.1:3000
     (stage-1 routes + stage-2 hours/availability over one SQLite file,
      started by deploy/start.mjs)
  -> existing SQLite database and booking logic
```

- Browser calls relative same-origin paths only; no API keys, stack traces,
  or database paths reach the browser output.
- Backend origin configurable via `BACKEND_URL`; unavailable backend is a
  deterministic JSON 5xx, never a crash or a fake success.
- The supervisor (`deploy/start.mjs`) spawns both processes, waits for
  `/health`, exits non-zero if a child fails, and shuts down on
  `SIGINT`/`SIGTERM`.
- Stages 1-2 expose no hours API; after a successful `POST /v1/restaurants`
  through the proxy, the `onRestaurantCreated` hook seeds default opening
  hours (Mon-Sun, 06:00-23:00) via `deploy/demo.mjs`, so availability works
  without out-of-band database writes.

## Layout

```
stage-4/
  frontend/index.html    canonical UI (Setup, Search, Book, Manage)
  frontend/app.js        request helper, validation, idempotency, error mapping
  frontend/styles.css    responsive styles (single column <= 640px)
  frontend/serve.mjs     static file server + same-origin API proxy
  deploy/start.mjs       process supervisor (backend + frontend modes)
  deploy/demo.mjs        default-hours seeder (hooked after restaurant 201)
  Dockerfile             pinned node:24.21.0-alpine3.24 image (root context)
  test/                  jsdom/component tests (Units 1-8)
  test/e2e/              Playwright suite (Unit 9, 5 scenarios)
  test/playwright.config.ts
  RUN.md                 run instructions and configuration reference
  TASK.md                frozen scope for this stage
```

## Commands

See [RUN.md](RUN.md) for full details.

```bash
npm start          # supervisor: backend on 3000 + proxy on 8080
npm test           # all stage-4 tests (Units 1-8)
npm run typecheck  # syntax check of browser/supervisor sources
npm run test:e2e   # Playwright, 5 scenarios, disposable database
docker build -f stage-4/Dockerfile -t tablekeeper-stage4 .   # from repo root
```

## Testing (TDD Units 1-9)

| Unit | Coverage | File |
|------|----------|------|
| 1 | Server/proxy contract (static, proxy, security, 5xx) | `test/server.test.mjs` |
| 2 | Request helper, state, idempotency key rules | `test/request-state.test.mjs` |
| 3 | Setup + Quick Demo orchestration | `test/ui-setup.test.mjs` |
| 4 | Availability search flow | `test/ui-availability.test.mjs` |
| 5 | Booking confirmation (201 vs 200, SLOT_TAKEN) | `test/ui-booking.test.mjs` |
| 6 | Manage + cancellation (204, NOT_FOUND) | `test/ui-manage.test.mjs` |
| 7 | Accessibility + responsive layout | `test/ui-a11y.test.mjs` |
| 8 | Process composition (startup, failure, SIGTERM) | `test/compose.test.mjs` |
| 9 | Playwright E2E (happy path, double booking, invalid duration, backend down, mobile) | `test/e2e/tablekeeper.spec.ts` |

Frozen stages are unaffected and run independently:
`cd ../stage-1 && npm test` (and stage-2, stage-3).

## Scope notes carried from the pre-stage placeholder

This README replaces the "placeholder. Not open yet" file that stood here
before Stage 3's acceptance. Its commitments carry forward unchanged:

- This stage **assembles** what stages 1-3 already built; it adds no new
  persistence semantics — the no-double-booking guarantee still rests on
  stage-1's occupancy store alone.
- Explicitly cut on purpose: waitlists, deposits, payments, notifications,
  loyalty, and third-party channel integrations. Each would need its own
  stage, task file, and owner rather than arriving unplanned.
- The factory's check still governs: with the service running and a
  populated database, book every table at every slot, then attempt the same
  bookings from a second process, with a retried request, across a
  daylight-saving transition, and under `TZ` set to a zone that is not the
  restaurant's — **zero double-bookings** (stage-1 tests; Stage 4's Unit 5
  replay/idempotency and Unit 9 double-booking scenarios extend it to the
  browser surface).
