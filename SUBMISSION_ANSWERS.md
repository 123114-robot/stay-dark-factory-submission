# Submission Answers — Evidence-Bounded Draft

## Project name

Stay Tablekeeper Factory

## One-sentence summary

A three-seat BAND factory planned, implemented, rejected, repaired, and reviewed a four-stage restaurant-reservation system with concurrency-safe storage and a responsive browser workflow.

## Product demonstrated

The preserved implementation contains a SQLite reservation core, idempotent writes, concurrency and timezone tests, availability logic, operational hardening, and a Stage 4 web application with setup, search, booking, lookup, cancellation, same-origin proxying, Docker packaging, and Playwright coverage.

## Factory design

- Planner owns scope, ordering, acceptance gates, and handoffs.
- Implementer writes scoped changes and returns exact receipts.
- Reviewer independently reproduces claims, attacks likely failures, and returns PASS or a bounded blocker.

The run records real rejection and repair cycles. Review found missing or incorrectly located UI artifacts, path-resolution and traversal concerns, dead request-helper code, misleading documentation, and an E2E shortcut that inserted hours directly. These were routed back into bounded corrections and re-reviewed.

## Verified evidence

Project tests passed at 57/57, 28/28, 54/54, and 81/81 across Stages 1–4. Stage 4 Playwright passed 5/5, and its Docker image built and served both `/health` and the UI. The full BAND room is preserved as `room.json`.

## Required disclosure

This is not yet a final official-harness claim. The current official Tablekeeper specification uses a different staged API contract, and the official preflight reports missing Stage 1–3 packaging. The Stage 4 recovery also included human continuation messages, so the room must not be presented as a zero-intervention scored run. See `SUBMISSION_COMPLIANCE.md`.

## Suggested presentation language

Present this branch as an auditable engineering artifact and recovery case study. Do not state that it passes the current official Dark Factory harness or satisfies the autonomy gate unless a new compliant run and official isolated harness evidence are produced.
