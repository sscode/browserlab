# Scope and evidence

The immediate goal covers the first three stages of BrowserLab. Open-source local execution comes first. A hosted subscription is a later product.

## Stage 1 — Problem and pilot validation

Deliverables: five interviews, representative customer workflows, and three teams that agree to evaluate the product.

The interview procedure and pilot record are in `pilot.md`. Real interviews and team commitments remain pending. Do not mark this stage complete from reference-suite results.

## Stage 2 — Working local comparison

Deliverables: a CLI, Chrome and Lightpanda adapters, explicit assertions, an offline report, and 20 controlled cases with expected outcomes.

The code provides these components. Completion evidence must include a real two-engine execution. Unit tests alone are insufficient. Preserve the command, engine versions, result counts, and report location in the release verification record.

## Stage 3 — Repeatable release checks

Deliverables: repeated trials, baseline acceptance, comparison gates, CI integration, and useful customer findings without manual report preparation.

The engineering scope includes accurate failure statuses, preserved retries, cancellation, session cleanup, JSON/JUnit output, and performance checks with minimum sample counts. External customer findings remain pending until pilot teams supply them.

## Open-source release gate

- Run unit and process tests.
- Run all 20 cases on both engines.
- Execute repeated trials and accept a baseline.
- Verify that a real page defect produces a failed CI command.
- Verify that cancellation saves partial results and closes the active session.
- Inspect the HTML report and its filters.
- Install a packed release in a clean directory.
- Confirm that the archive excludes local reports, credentials, and development tests.
- Publish source and install instructions to the selected repository.

## Later work

Browserbase, Browserless, Steel, Browser Use Cloud, Bright Data, Hyperbrowser, and Anchor adapters are implemented at the owner's request. Provider protocol tests are available; live cloud acceptance needs user-supplied credentials. Additional providers require a demonstrated customer need. Agent-framework comparisons need a separate task contract and repeated stochastic trials. They must not replay engine-specific actions blindly.

The potential $99/month service adds team accounts, shared history, reviewed baselines, and CI reporting. Customer machines can continue to execute browsers. Account management, hosted storage, subscription billing, and customer acquisition are outside these first three engineering stages.

Keep the local runner useful without a subscription. Do not introduce mandatory uploads or remove local reports to create the paid tier.
