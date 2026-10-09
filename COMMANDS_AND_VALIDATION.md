# Commands and Validation Record

Executed on Windows 11 / PowerShell on 2026-10-09 unless noted.

## Source identity

```powershell
git status --short --branch
git show -s --format=%H%n%T%n%P HEAD
git diff --check 4a4e00b..HEAD
```

Observed source state:

- Branch `feature/stage-4-ui`, clean and two commits ahead of its original remote baseline.
- HEAD `c7a3cc3069583f7af46b6ebafa91ba3cdcb82937`.
- Tree `6c912d5027693fd15a36c6417e6bc1c1e0eacbfb`.
- Parent `d6960137b5253c0a1d8090bec72848ceec314d5a`.
- Diff whitespace check passed.

## Project tests

```powershell
cd stage-1; npm test
cd stage-2; npm test
cd stage-3; npm test
cd stage-4; npm test
cd stage-4; npm run typecheck
cd stage-4; npm run test:e2e
```

Observed results:

| Command | Result |
| --- | --- |
| Stage 1 `npm test` | 57 passed, 0 failed |
| Stage 2 `npm test` | 28 passed, 0 failed |
| Stage 3 `npm test` | 54 passed, 0 failed |
| Stage 4 `npm test` | 81 passed, 0 failed |
| Stage 4 `npm run typecheck` | exit 0 |
| Stage 4 `npm run test:e2e` | 5 passed, 0 failed |

The Playwright scenarios cover Quick Demo through booking and cancellation, an already-taken slot, invalid duration, unreachable backend, and a narrow mobile viewport.

## Docker verification

```powershell
cd stage-4
npm run docker:build
docker run -d --name tablekeeper-stage4-verify -p 18080:8080 -e DATABASE_PATH=:memory: tablekeeper-stage4
Invoke-RestMethod http://127.0.0.1:18080/health
Invoke-WebRequest http://127.0.0.1:18080/
docker rm -f tablekeeper-stage4-verify
```

Observed: image build exit 0; health returned `{"status":"ok"}`; home page returned HTTP 200 and contained `TableKeeper`.

## Scope and secret checks

```powershell
git diff --quiet 4a4e00b -- stage-1 stage-2 stage-3
git grep -n -I -E '(ghp_|github_pat_|sk-|rc_|AKIA|BEGIN .*PRIVATE KEY)' HEAD -- stage-4
```

Observed: frozen scope passed; no tracked Stage 4 match for the selected credential patterns.

## Official submission preflight

```powershell
$env:PYTHONUTF8='1'
python -m harness check <submission-repo> --track tablekeeper
```

Observed: `room.json` and mandate checks were readable, but preflight failed because Stages 1–3 lack required `Dockerfile` and `RUN.md` files. The current official stage specifications also describe a different API/stage contract. No official harness PASS is claimed.
