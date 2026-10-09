# Publication and Compliance Plan

## Completed for this evidence branch

1. Preserve the Stage 1–4 files from the reviewed team worktree.
2. Preserve the unmodified full BAND room export.
3. Replace draft mandate names with the actual Planner, Implementer, and Reviewer seat names.
4. Record runtime/model metadata, source revision, commands, pass counts, problems, and recovery actions.
5. Compare the result against the current official guide and disclose every gap.
6. Publish on a branch owned by `123114-robot`; do not bypass teammate-repository permissions.

## Required before claiming an official passing submission

1. Lock the current official Tablekeeper specifications as the source of truth.
2. Implement the official API and UI contract stage by stage in a fresh factory run.
3. Give each claimed stage a complete standalone Dockerfile and RUN.md.
4. Run official `harness check` successfully.
5. Run every claimed stage through official isolated Docker mode.
6. Retain the exact harness reports, fresh room export, commit history, and secret scan.
7. Record the required BAND-room and product video and create slides.

## Stop condition

Do not submit claims of official compatibility, isolated-harness PASS, or zero-intervention autonomy while `SUBMISSION_COMPLIANCE.md` contains a FAIL, MISSING, or NOT ESTABLISHED result for that claim.
