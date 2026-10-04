# Contributing

Use Node.js 24 or later. Run `npm ci`, `npm test`, and `npm run check` before submitting a change.

For adapter changes, run the real two-engine suite with `npm run verify:engines`. Install Chrome and Lightpanda first. Record engine versions and the report summary with the change.

Keep adapters separate from assertions and report code. Preserve raw statuses. Never turn an unsupported operation, a timeout, or missing data into a pass. Do not add network uploads or telemetry without an explicit product decision.

Add a focused regression test when you fix a correctness defect. Use controlled local pages for integration tests. Do not depend on third-party websites for required CI checks.

Before sharing a result file, remove credentials and private page data. Do not commit `.browserlab`, browser profiles, or screenshots from private websites.

The project uses the MIT license. Contributions use the same license.
