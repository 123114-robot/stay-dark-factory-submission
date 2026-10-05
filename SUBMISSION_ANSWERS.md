# Submission Answers Draft

## Project name

Stay Tablekeeper Factory

## One sentence summary

Stay Tablekeeper Factory is a three-agent software factory that plans, builds, and independently verifies a restaurant reservation service against explicit acceptance gates.

## Problem

Restaurant reservation systems fail in difficult but realistic conditions such as concurrent booking requests, duplicated network delivery, invalid local times, and partial updates. A convincing solution must do more than display a booking screen: it must prove that critical invariants hold under contention and failure.

## Solution

The factory assigns three independent seats:

1. Planner converts the specification into bounded tasks and measurable acceptance criteria.
2. Builder implements only the active task and returns an evidence receipt.
3. Verifier reruns tests, challenges the implementation, and either blocks or certifies the stage.

The intended product is a containerized reservation service with a browser interface. Critical booking guarantees are enforced in the persistence layer, while the factory records decisions, failures, fixes, and verification results.

## Why BAND

BAND is used as the coordination and evidence layer for the multi-agent run. The value is not a scripted conversation: each seat has a distinct mandate, agents hand work to one another, and the Verifier can reject the Builder's result without waiting for a human to direct every step.

## Agent teamwork

The Planner owns scope and acceptance criteria. The Builder owns implementation and targeted tests. The Verifier owns independent reproduction, adversarial checks, and the final verdict. A stage cannot advance on the Builder's self-report alone.

## Recovery design

When work fails, the factory preserves the current evidence, identifies the smallest blocking defect, returns a bounded correction task to the Builder, and requires the Verifier to rerun the failed gate. Repeated or ambiguous failures are reported as blockers instead of being hidden by broad rewrites.

## Original contribution

This submission uses an original factory description, mandates, implementation, test data, UI, and narrative. It borrows only general software-engineering patterns. It does not copy another participant's code, documentation, prompts, test output, or commit history.

## Current evidence statement

This document is a submission draft. A final claim of completion requires a fresh BAND room export, generated repository history, official harness output, container build evidence, UI evidence, and a recorded demo. Until those artifacts exist, application completion remains UNVERIFIED.

## Suggested short pitch

Stay Tablekeeper Factory turns a reservation specification into a traceable build-and-review process. A Planner defines measurable gates, a Builder implements the stage, and an independent Verifier attacks the result before certification. The final demo shows both the reservation product and the factory evidence that explains why the result should be trusted.
