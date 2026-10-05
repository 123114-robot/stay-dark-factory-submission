# Factory Operating Model

## Purpose

This factory produces a specification-conformant service through explicit planning, bounded implementation, and independent verification. The workflow is generic and must not contain track-specific endpoints, fields, or error codes in the seat mandates.

## Seats

- Planner owns task boundaries, dependencies, acceptance criteria, and handoffs.
- Builder owns implementation, focused tests, and an exact change receipt.
- Verifier owns independent test execution, adversarial review, and certification.

## Workflow

1. Planner reads the authoritative specification and current repository state.
2. Planner publishes one bounded task with allowed files, non-goals, and observable acceptance criteria.
3. Planner tags Builder with that task.
4. Builder inspects the current state, implements the smallest compliant change, runs targeted tests, and tags Verifier with a receipt.
5. Verifier checks the actual files and reruns the claimed commands. The Verifier also tests at least one likely failure mode.
6. If blocked, Verifier returns a precise defect and reproduction command to Builder.
7. Builder fixes only the blocking defect and returns a new receipt.
8. Verifier certifies only when every acceptance criterion has direct evidence.
9. Planner records the stage result and opens the next bounded task.

## Stop conditions

- Stop if the authoritative specification is missing or contradictory.
- Stop if the workspace contains unknown changes in frozen scope.
- Stop if a required test cannot run; report it as UNVERIFIED.
- Stop if verification depends only on the Builder's statement.
- Stop if secrets, credentials, or personal data appear in tracked files or logs.

## Evidence receipt

Each handoff records:

- starting revision and branch
- files changed
- commands executed
- pass, fail, and skipped counts
- known limitations and UNVERIFIED items
- whether any push, merge, or deployment occurred

## Certification rule

Only the Verifier may certify a stage. Certification means the repository state, tests, and required packaging were inspected directly. It does not prove deployment, browser behavior, or external-service access unless those were separately exercised and recorded.
