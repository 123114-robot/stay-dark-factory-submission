/**
 * Composition-layer fixture preparation (TASK.md section 9, R3).
 *
 * Stages 1-2 expose no hours endpoint (frozen scope), so a restaurant created
 * through the browser would fail-close to zero availability. deploy/start.mjs
 * injects seedDefaultHours into serve.mjs's optional onRestaurantCreated hook:
 * after the proxy buffers a 201 from POST /v1/restaurants, the hook opens the
 * database with node:sqlite (via the Stage 1 opener), applies Stage 2's
 * exported migrate2, and writes default hours for weekdays 0-6, 06:00-23:00
 * local wall-clock minutes. All SQL for this preparation lives here, in
 * deploy/; serve.mjs holds no SQL and no database imports. The Stage 1/2
 * modules are imported read-only — no frozen file is changed.
 *
 * Restaurants created outside this composition (standalone serve.mjs, direct
 * API use) get no hours until hours exist — documented in README.md and
 * RUN.md. Hook absence in a standalone run means no fixture preparation.
 */

const DEFAULT_OPENS_MIN = 6 * 60;
const DEFAULT_CLOSES_MIN = 23 * 60;

/**
 * Seed default service hours for one restaurant.
 *
 * @param {string} restaurantId - Restaurant created through the composition.
 * @param {string} dbPath - Path to the TableKeeper SQLite database.
 */
export async function seedDefaultHours(restaurantId, dbPath) {
  const { openDatabase, closeDatabase } = await import('../../stage-1/src/db.ts');
  const { migrate2 } = await import('../../stage-2/src/hours.ts');

  const db = openDatabase(dbPath);
  try {
    migrate2(db);
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO restaurant_hours (restaurant_id, weekday, opens_min, closes_min) VALUES (?, ?, ?, ?)',
    );
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      stmt.run(restaurantId, weekday, DEFAULT_OPENS_MIN, DEFAULT_CLOSES_MIN);
    }
  } finally {
    closeDatabase(db);
  }
}
