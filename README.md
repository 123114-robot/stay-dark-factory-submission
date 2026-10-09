# Stay Tablekeeper Factory — Stage 1–4 Evidence Branch

This branch preserves the Tablekeeper implementation produced through a three-seat BAND room, together with the complete room export, seat mandates, stage source, tests, delivery files, and an evidence-bounded compliance report.

## Read this first

The repository is public and auditable, but this branch does **not** claim a passing result from the current official Dark Factory Tablekeeper harness. Local project tests pass, while the official preflight currently reports missing per-stage packaging for Stages 1–3. A contract comparison also found that this implementation's `/v1/...` API is not the same contract as the current official Stage 2–4 specification. See [SUBMISSION_COMPLIANCE.md](SUBMISSION_COMPLIANCE.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `mandates/` | Generic mandates for the actual Planner, Implementer, and Reviewer seats |
| `room.json` | Unmodified full-room download from BAND |
| `stage-1/` | SQLite booking core, concurrency, idempotency, HTTP, and timezone tests |
| `stage-2/` | Hours, table selection, availability, and search/write parity |
| `stage-3/` | Auth, rate limiting, audit, migration, restart, logging, and timezone hardening |
| `stage-4/` | Responsive browser UI, same-origin proxy, deployment supervisor, Dockerfile, RUN.md, and Playwright E2E |
| `STAGE_SUMMARY.md` | What each stage actually contains |
| `BAND_RUN_REPORT.md` | How BAND was configured, operated, recovered, and reviewed |
| `COMMANDS_AND_VALIDATION.md` | Commands executed and their observed results |
| `SUBMISSION_COMPLIANCE.md` | Official-rule mapping, passes, gaps, and required follow-up |
| `EVIDENCE_CHECKLIST.md` | Claim-by-claim evidence state |

## Verified local results

- Stage 1: 57/57 project tests passed.
- Stage 2: 28/28 project tests passed.
- Stage 3: 54/54 project tests passed.
- Stage 4: 81/81 tests, syntax/type checks, and 5/5 Playwright scenarios passed.
- Stage 4 Docker image built successfully; `/health` returned `{"status":"ok"}` and `/` returned HTTP 200.
- Frozen Stage 1–3 scope check, tracked-secret scan, and `git diff --check` passed in the source worktree.
- BAND Reviewer returned PASS for the Stage 4 task at source commit `c7a3cc3069583f7af46b6ebafa91ba3cdcb82937`.

These results establish the behavior of this implementation against its own project contract. They do not substitute for the official event harness.

## Run Stage 4 locally

Requirements: Node.js 24+ and npm.

```bash
cd stage-4
npm install
npm start
```

Open `http://127.0.0.1:8080/`. Full operational instructions are in `stage-4/RUN.md`.

## Evidence integrity

The application files were transferred from the team working repository
`natchaphat5106-collab/dark-factory-tablekeeper`, source branch
`feature/stage-4-ui`, at commit `c7a3cc3069583f7af46b6ebafa91ba3cdcb82937`.
The transfer preserves file contents but does not pretend that this packaging commit was authored by the BAND seats.

## Official references

- Participant guide: https://github.com/band-ai/dark-factory-wearedevs/blob/main/docs/participant-guide.md
- Event page: https://lablab.ai/ai-hackathons/wearedevelopers-hackathon
