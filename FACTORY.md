# Factory Operating Model

## Purpose

This factory separates planning, implementation, and independent review so that no implementation seat certifies its own work. It is reusable because the seat mandates describe behavior rather than Tablekeeper endpoints or fields.

## Actual seats

| Seat | Responsibility | May certify? |
| --- | --- | --- |
| Planner | Converts owner objectives into bounded tasks, file scope, ordering, and measurable gates | No |
| Implementer | Uses TDD where practical, changes only the open scope, and returns exact evidence receipts | No |
| Reviewer | Reproduces claims, adds adversarial checks, rejects defects, and issues the final verdict | Yes |

The mandate filenames match the room display names: `planner.md`, `implementer.md`, and `reviewer.md`.

## Runtime

- Coordination: BAND room
- Harness: OpenCode through three local BAND adapters
- Model: `featherless/moonshotai/Kimi-K2.5`
- Shared worktree: `C:\Users\deba3\band-work\result`
- Working branch: `feature/stage-4-ui`

Provider credits and exact model-token spend were not exported in a reliable machine-readable receipt, so monetary cost is `UNVERIFIED`. The room timestamps and adapter logs are retained for elapsed-time reconstruction.

## Work loop

1. Owner supplies the authoritative task, repository, branch, frozen scope, acceptance gates, and stop conditions.
2. Planner reads the repository and publishes one executable task.
3. Planner tags Implementer with scope, non-goals, and commands.
4. Implementer writes a failing test when practical, implements the smallest change, runs targeted checks, and returns a receipt.
5. Reviewer opens the actual files, reruns commands, checks scope and secrets, and attacks the most likely false-positive path.
6. On failure, Reviewer names a concrete reproduction and the minimum acceptable correction.
7. Planner routes the bounded correction to Implementer.
8. Reviewer reruns the failed gate and either rejects again or certifies the exact commit/tree.

## Evidence receipt

Every handoff should state:

- repository and branch
- starting and resulting revisions
- files changed
- commands executed and observed results
- scope and secret checks
- skipped or unavailable checks
- push, merge, and deployment state

## Failure handling demonstrated in the preserved room

- Wrong workspace: stop rather than recreate frozen stages.
- Provider or adapter stall: preserve the checkpoint and restart only the missing process.
- Claimed files absent: reject the receipt and require exact path evidence.
- Tests validating fixtures instead of shipped UI: redirect tests to canonical files.
- Path and documentation defects: require mutation-capable regression tests and correct the claim.
- Docker unavailable: record `UNVERIFIED` instead of converting absence into PASS.
- SHA ambiguity: compare commit, parent, tree, and raw diff digest before locking the receipt.

## Guardrails

- Frozen stages are not modified by a later stage.
- Test fixtures must be explicit and disposable; they cannot masquerade as production UI.
- No seat pushes or merges unless the owner opens that operation.
- No secret or credential belongs in source, logs, mandates, or the exported room.
- A project-test PASS is not called an official-harness PASS.

## Known limitation of this run

Human continuation messages were used during recovery from provider/adapter interruptions. The room is therefore useful evidence of collaboration and failure recovery, but this repository does not call it a zero-intervention scored run.
