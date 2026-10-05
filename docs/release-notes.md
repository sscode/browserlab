# BrowserLab 0.4.0 alpha

This open-source alpha makes the terminal the main interface and removes repeated Node launcher startup from browser commands. The CLI runs on macOS and Linux and targets read-only browser workflows.

## Terminal and launch speed

Runs print trial results, failed assertions, cleanup errors, a target summary, and baseline findings. HTML is now optional: add `--html`, or use `browserlab report <results.json>`. JSON and JUnit remain automatic. Scripts that require `report.html` must add `--html`.

The adapter resolves the installed native agent-browser executable once. It retains the upstream launcher for unsupported layouts or executables that are not ready to run. The explicit `BROWSERLAB_AGENT_BROWSER` override still works. Help and version skip execution module loading.

Results record the adapter launch method. When it differs from the baseline, correctness checks remain active but timing gates are disabled. Accept a new baseline after upgrading to measure future timing changes.

Node 24 remains the runtime. A scriptc 0.2.2 coverage check found blockers in WebSocket and file APIs. Adding compatibility code would oppose this release's aim of a small, simple CLI.

## Provider support

This alpha adds Steel, Browser Use Cloud, Bright Data Browser API, Hyperbrowser, and Anchor. It retains Browserbase and Browserless. Each adapter exposes create, connect, inspect, and stop operations. Results record provider-managed settings and distinguish API-confirmed cleanup from a CDP close acknowledgement.

The new `accept` command checks live extraction, deliberate failures, timeout, cancellation, and cleanup against hosted reference pages. Users supply their own local credentials. Provider protocols and the acceptance procedure have mock tests; real Chrome verifies private CDP attachment and the Bright Data connection bridge. Live cloud acceptance remains pending. See [provider setup](providers.md).

Hosted baselines from version 0.2 need renewed acceptance because version 0.3 records explicit provider settings. Existing local suites and results remain supported.

## Included

- JSON test suites with explicit assertions.
- Chrome and Lightpanda execution through agent-browser 0.38.2.
- A local reference site with 20 positive and negative cases.
- Repeated trials, alternating engine order, and preserved retries.
- Isolated sessions, time limits, cancellation, and cleanup checks.
- Baseline acceptance and correctness/performance comparisons.
- Searchable offline HTML, raw JSON, and JUnit reports.
- CI example, contribution guide, and pilot evaluation kit.
- A checksum-verified Lightpanda 1.0.0 installer.

## Limitations

The CLI is an early alpha. The workflow format can change before version 1.0. BrowserLab currently supports a defined JSON command set, not arbitrary automation scripts.

There is no hosted execution, result-upload service, model evaluation, or automatic engine selection. Screenshots require Chrome. Visual layout assertions are outside the initial scope.

Memory uses sampled RSS and can count shared pages twice. CPU measurements are lower bounds. Performance gates are heuristics. See `methodology.md` for comparison limits.

Customer adoption has not been validated. Reference-suite success does not prove compatibility with all websites.

## Install from a supplied archive

```sh
mkdir browserlab-pilot
cd browserlab-pilot
npm init -y
npm install /absolute/path/to/browserlab-0.4.0.tgz
npx agent-browser install
node node_modules/browserlab/scripts/install-lightpanda.mjs 1.0.0
npx browserlab doctor
npx browserlab demo --repetitions 1
```

Replace the archive path with the supplied file's location. This installs the CLI in the pilot directory. The next two commands install the browser binaries. The Lightpanda installer checks the publisher's checksum. Set `BROWSERLAB_LIGHTPANDA` to use a custom binary path; the installer also uses this path. A source checkout includes the equivalent `npm run install:lightpanda` command.

The archive is separate from the browser binaries. The project name has not been reserved on npm. Do not assume that the public npm package with the same name belongs to this project.
