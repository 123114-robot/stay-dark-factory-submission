# Minimum Submission Plan

## Objective

Produce one eligible, evidence-backed Stage 1 implementation and a truthful submission package before attempting optional stages.

## Phase 1 Specification lock

- Use the official track specification as the source of truth.
- Record required endpoints, state behavior, error contracts, test controls, port behavior, and packaging requirements.
- Treat teammate or competitor repositories only as non-authoritative references.

Exit gate: Planner publishes a traceability table from each official requirement to an acceptance test.

## Phase 2 Clean BAND run

- Start a fresh room with Planner, Builder, and Verifier.
- Give only the project objective and authoritative inputs.
- Do not issue mid-run implementation instructions.
- Preserve bidirectional agent mentions and handoffs.

Exit gate: the room log proves that at least two seats addressed and answered one another and that verification occurred independently.

## Phase 3 Application gate

- Build the minimum official Stage 1 behavior.
- Add a Dockerfile and RUN.md in the required location.
- Run targeted tests, then the official isolated harness.
- Scan tracked content for secrets.

Exit gate: clean container build, service startup, official Stage 1 harness pass, and zero tracked secrets.

## Phase 4 Submission package

- Export the complete room log.
- Add accurate README setup and architecture sections.
- Create slides that distinguish demonstrated facts from planned work.
- Record a short video showing the BAND handoffs, repository evidence, container start, and product behavior.

Exit gate: every public claim maps to a visible artifact.

## Non-goals until eligibility is secured

- copying another participant's UI or source
- polishing a large frontend
- claiming later stages without harness evidence
- publishing secrets or private room credentials
- replacing missing proof with screenshots of text claims
