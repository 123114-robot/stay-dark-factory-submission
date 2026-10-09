# TableKeeper Stage 4 - Run Instructions

Requirements: **Node.js >= 24** (native TypeScript type stripping and
`node:sqlite` are used by the stage-1/stage-2 sources), npm, and optionally
Docker for the container build. No runtime npm dependencies are required.

## Quick Start

### One command (recommended: supervisor)

```bash
cd stage-4
npm start
```

This starts the composed backend on port **3000** (stage-1 routes + stage-2
availability/hours over one SQLite file) and the stage-4 static server and
same-origin proxy on port **8080**, and only reports ready once
`http://127.0.0.1:8080/health` answers.

Open your browser to: http://localhost:8080

If a required child fails to start (for example the backend port is already
occupied), the supervisor terminates with a non-zero exit code.
`SIGINT`/`SIGTERM` shut both children down cleanly.

## Available Scripts

```bash
# Run all stage-4 tests (server/proxy, request/state rules, Units 3-8)
npm test

# Browser logic tests only (Units 1-2)
npm run test:unit

# Syntax check of the browser and supervisor sources
npm run typecheck

# Start supervisor (backend + frontend)
npm start

# Serve frontend only (requires a backend already running)
npm run serve

# Playwright end-to-end suite (5 scenarios, starts its own services)
npm run test:e2e

# Build and run with Docker (from stage-4; build context is the repo root)
npm run docker:build
npm run docker:run
```

## Manual Steps (two processes)

### 1. Start the composed backend

```bash
cd stage-1
PORT=3000 npm start
```

### 2. Start the stage-4 frontend/proxy

In a new terminal:

```bash
cd stage-4
PORT=8080 BACKEND_URL=http://127.0.0.1:3000 npm run serve
```

## Application Flow

### 1. Setup (Create Restaurant and Tables)

- Navigate to the "Setup" tab
- Enter restaurant name and IANA time zone
- Enter table capacities (at least two tables recommended)
- Click "Create Restaurant & Tables" (or "Run Quick Demo Setup")
- The created identifiers are displayed and carried into Search
- Restaurants created through this proxy also receive default opening hours
  (Mon-Sun, 06:00-23:00) — see "Known Limitations" below

### 2. Availability Search

- Navigate to the "Search" tab
- Enter restaurant ID, local date (YYYY-MM-DD), party size,
  and duration (15-720 minutes, divisible by 15)
- Click "Search Availability"
- Every slot shows its local start, UTC start, and table IDs

### 3. Book a Table

- Click "Select" on an available slot
- Review the confirmation summary and press "Confirm Booking"
- The booking ID is displayed and carried into Manage

### 4. Manage a Booking

- Navigate to the "Manage" tab (booking ID prefilled from the last booking)
- Click "Look Up" to view the booking
- Press "Cancel Booking", confirm in the page, to cancel (HTTP 204)
- Cancelling again reports the backend's NOT_FOUND

## API Endpoints

All API calls are same-origin, proxied by the stage-4 server:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/restaurants` | POST | Create restaurant |
| `/v1/restaurants/:id/tables` | POST | Create table |
| `/v1/restaurants/:id/availability` | GET | Search availability |
| `/v1/bookings` | POST | Create booking |
| `/v1/bookings/:id` | GET | Get booking |
| `/v1/bookings/:id` | DELETE | Cancel booking |

## Configuration

Environment variables read by the supervisor (`npm start`):

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_HOST` | 127.0.0.1 | Interface for the internal backend |
| `BACKEND_PORT` | 3000 | Internal backend port |
| `FRONTEND_HOST` | 127.0.0.1 | Interface for the frontend/proxy (0.0.0.0 in the container) |
| `FRONTEND_PORT` | 8080 | Frontend/proxy port |
| `DATABASE_PATH` | stage-4/tablekeeper.db | SQLite database file |

Variables read by the standalone proxy (`npm run serve`): `PORT` (default
8080), `BACKEND_URL` (default http://127.0.0.1:3000), `FRONTEND_DIR`
(default the `frontend/` directory).

## Known Limitations

**No hours API.** Stages 1-2 expose no endpoint that reads or writes
`restaurant_hours`, so this stage ships no hours editor. Default hours are
seeded only when a restaurant is created through the stage-4 proxy: after a
buffered `201` from `POST /v1/restaurants`, the optional
`onRestaurantCreated` hook in `frontend/serve.mjs` writes Mon-Sun
06:00-23:00 rows via `deploy/demo.mjs` (the only place stage 4 runs SQL).
A restaurant created by calling the backend directly on port 3000 has no
hours rows, and `GET /v1/restaurants/:id/availability` then returns
`{"slots":[]}`.

## Backup and Restore

The database is a single SQLite file (`DATABASE_PATH`, default
`stage-4/tablekeeper.db`) kept in WAL mode. The commands below were each
executed end-to-end (online backup, cold copy, restore) against a database
created by stage-1 `openDatabase` + stage-2 `migrate2` — the same schema
the supervisor uses — and all three files contained identical rows.

### Option A: online backup while the service runs (`VACUUM INTO`)

```bash
node -e "const { DatabaseSync } = require(\"node:sqlite\"); const db = new DatabaseSync(process.argv[1]); db.exec('VACUUM INTO \'' + process.argv[2] + '\''); db.close(); console.log('backup written:', process.argv[2]);" tablekeeper.db tablekeeper-backup.db

node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1], { readOnly: true }); console.log("backup rows:", JSON.stringify(db.prepare("SELECT id FROM restaurant ORDER BY id").all())); db.close();' tablekeeper-backup.db
```

`VACUUM INTO` takes a consistent snapshot even with active connections and
produces one self-contained file (no `-wal`/`-shm` siblings).

### Option B: cold copy (service stopped)

Stop the service first, then copy the file and any WAL siblings:

```bash
cp tablekeeper.db tablekeeper-copy.db
if [ -f tablekeeper.db-wal ]; then cp tablekeeper.db-wal tablekeeper-copy.db-wal; fi
if [ -f tablekeeper.db-shm ]; then cp tablekeeper.db-shm tablekeeper-copy.db-shm; fi

node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1], { readOnly: true }); console.log("file-copy rows:", JSON.stringify(db.prepare("SELECT id FROM restaurant ORDER BY id").all())); db.close();' tablekeeper-copy.db
```

Copying the `.db` file without its `-wal` sibling can lose transactions
still sitting in the write-ahead log.

### Restore (service stopped)

```bash
rm -f tablekeeper.db tablekeeper.db-wal tablekeeper.db-shm
cp tablekeeper-backup.db tablekeeper.db
if [ -f tablekeeper-backup.db-wal ]; then cp tablekeeper-backup.db-wal tablekeeper.db-wal; fi
if [ -f tablekeeper-backup.db-shm ]; then cp tablekeeper-backup.db-shm tablekeeper.db-shm; fi

node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1], { readOnly: true }); console.log("restored rows:", JSON.stringify(db.prepare("SELECT id FROM restaurant ORDER BY id").all())); db.close();' tablekeeper.db
```

Start the service again after restoring. To restore from a cold copy
instead, use the copied file and its siblings the same way.

## Error Handling

The UI shows the backend's error envelope code next to a friendly message,
never transforming an error into a success state:

- `SLOT_TAKEN` - the requested slot is already booked
- `INVALID_TIME` - outside the restaurant's opening hours
- `AMBIGUOUS_LOCAL_TIME` - fall-back overlap, retry with `fold` 0 or 1
- `INVALID_DURATION` - duration not divisible by 15 or out of range
- `TABLE_TOO_SMALL` / `INVALID_TABLE` - table capacity or id problem
- `NOT_FOUND` - booking or restaurant not found
- `[SERVICE_UNAVAILABLE]` - backend unreachable (deterministic 5xx proxy answer)

## Docker Deployment

The image copies only the files the supervisor loads at runtime and has a
pinned base (`node:24.21.0-alpine3.24`); stages 1-4 have no runtime
dependencies, so no `npm install` happens inside the image.

### Build (from the repository root)

```bash
docker build -f stage-4/Dockerfile -t tablekeeper-stage4 .
# or, from stage-4:
npm run docker:build
```

### Run

```bash
docker run --rm -p 8080:8080 tablekeeper-stage4
# disposable in-memory database:
docker run --rm -p 8080:8080 -e DATABASE_PATH=:memory: tablekeeper-stage4
# persistent database on a host directory:
docker run --rm -p 8080:8080 -v $(pwd)/data:/data tablekeeper-stage4
```

Only port 8080 is published; the backend listens on 127.0.0.1:3000 inside
the container. A Docker `HEALTHCHECK` polls `/health` every 30 seconds.

## Troubleshooting

### Backend connection failed (banner shows "Backend unavailable")

1. Check that a backend is running on `BACKEND_PORT` (default 3000)
2. Check `BACKEND_URL` for the standalone proxy
3. `npm test` includes deterministic backend-unavailable tests

### Port already in use

```bash
BACKEND_PORT=3001 FRONTEND_PORT=8081 npm start
```

The supervisor exits non-zero if the backend port is occupied.

### Tests failing

```bash
cd stage-4 && npm test && npm run typecheck && npm run test:e2e
```

Stage 1-3 are frozen and run independently: `cd ../stage-N && npm test`.
