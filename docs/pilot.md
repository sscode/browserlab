# Open-source pilot kit

## Current customer evidence

No customer interviews or external team evaluations have been completed for this project. The reference suite is engineering evidence, not customer validation.

The first pilot should involve three teams with existing browser extraction workflows. Interview five teams to find suitable participants. The project owner must supply introductions or authorize specific outreach. No outreach has been sent.

## Suitable teams

- The team maintains browser automation that it executes at least weekly.
- A failure can produce missing or incorrect data.
- The team can supply a read-only test workflow and expected results.
- The team can execute local commands or CI jobs.
- The team has a reason to compare engines or detect release regressions.

Avoid a pilot that requires private production credentials, irreversible actions, or support for many new frameworks before the first useful result.

## Interview procedure

Ask these questions before demonstrating the product:

1. What browser workflow failed most recently?
2. How did you discover the failure?
3. What result should the workflow have produced?
4. How do you check correctness before release?
5. Which browser and automation versions do you use?
6. What prevents you from trying another engine?
7. Who would use a comparison report?
8. Can you provide a small read-only workflow for evaluation?

Record the workflow, failure, existing check, decision owner, and next evaluation date. Do not treat interest in a demo as evidence of recurring use.

## First evaluation

1. Install from the repository or a supplied release archive.
2. Execute `browserlab doctor`.
3. Execute `browserlab demo --repetitions 1`.
4. Create one customer test case.
5. Add assertions for an important failure mode.
6. Execute it on the supported engines.
7. Open the report without assistance from the project author.
8. Save a baseline if all expected outcomes match.
9. Introduce a controlled data or page defect.
10. Confirm that CI fails and that the report explains why.

Do not introduce defects into a production website. Use a local or staging copy.

## Evaluation record

| Field | Value |
| --- | --- |
| Team and contact | Pending |
| Workflow and source site | Pending |
| Expected output | Pending |
| Installation duration | Pending |
| Time to first useful report | Pending |
| Defect detected | Pending |
| Incorrect alerts | Pending |
| Help required | Pending |
| Decision changed by the report | Pending |
| Next execution date | Pending |

## Stage-three acceptance

At least three teams must evaluate representative workflows. Teams must identify useful failures without manual report preparation by the project author. Save their observations and reproduction cases with permission.

If teams only want a one-time engine comparison, investigate a migration assessment. Do not assume that they need a subscription.

## Draft invitation for the owner to send

> We are testing an open-source tool for browser workflow checks. It runs the same task on Chrome and Lightpanda and compares correctness and timing. Everything executes locally. Would your team try one read-only extraction workflow and tell us whether the report helps you make a release decision? The first evaluation should use a test site or non-sensitive public data.

This is a draft. It has not been sent.
