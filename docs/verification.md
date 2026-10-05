# Alpha verification record

Date: 2026-10-04. Environment: macOS, Apple Silicon, Node.js 24.16.0.

## Observed engineering evidence

| Check | Result | Local evidence |
| --- | --- | --- |
| TypeScript build and type checks | Passed | `npm run build`, `npm run check` |
| Unit and process checks | 20 passed | `npm test` |
| Repeated two-engine reference suite | 200/200 declared outcomes matched | `.browserlab/baseline-run/results.json` |
| Second repeated reference suite | 200/200 declared outcomes matched | `.browserlab/comparison-run/results.json` |
| Baseline comparison | Compatible; no regressions | `.browserlab/comparison-run/comparison.json` |
| Session cleanup in the repeated runs | All graceful; no cleanup errors | The two result files above |
| Real page defect | Both engines failed; CLI returned 1 | `.browserlab/integration-1791136294708/broken/` |
| Rejection of failed baseline | CLI returned 2 | Real-engine integration procedure |
| Chrome screenshot | Valid PNG signature | Integration `visual/` artifacts |
| Lightpanda screenshot request | Unsupported before browser startup | Integration `unsupported/` results |
| Environment secret handling | Fill passed; secret absent from JSON, HTML, and XML | Integration `secrets/` results |
| Cancellation | Exit 130; partial results saved; no cleanup error | Integration `cancelled/` results |
| Report interaction | Search, engine filter, nested details, and empty state passed | Browser inspection of generated report |
| Report layout | Inspected at 1280px and narrow viewport; no observed overlap | Browser inspection of generated report |
| Clean archive installation | Installed CLI and both engine checks passed | Temporary installation outside source tree |
| Installed archive workflow | 20/20 declared outcomes matched on Chrome | `.browserlab/package-smoke/results.json`, using the CLI installed in `/tmp/browserlab-alpha-final` |
| Final two-engine smoke check | 40/40 declared outcomes matched with exact version metadata | `.browserlab/release-verification/results.json` |
| Final session inventory | No active BrowserLab sessions | `agent-browser --namespace browserlab session list --json` |
| Public source publication | Public MIT repository; source pushed to `main` | [sscode/browserlab](https://github.com/sscode/browserlab) |
| Linux GitHub CI | Core checks, 120 reference trials, and real-engine integration passed | [Run 37241720164](https://github.com/sscode/browserlab/actions/runs/37241720164), commit `d8b0ba4` |

The repeated run used agent-browser 0.38.2, Chrome 154, and Lightpanda 1.0.0. The first version metadata used user-agent strings. A later correction reads exact Chrome metadata through CDP and the Lightpanda version from its binary. Lightpanda's CDP endpoint reports a Chrome compatibility version, which must not be presented as its engine version.

Exact engine checks after that correction: Chrome 154.0.8037.93 and Lightpanda 1.0.0.

The reference suite contains deliberate failures. Matching those expectations proves that the runner detects the selected error conditions. It does not mean that all 200 trials extracted valid data.

## Version 0.2.0 provider checks

The Browserbase and Browserless additions were checked on the same macOS host. No live cloud credentials were used.

| Check | Result | Evidence |
| --- | --- | --- |
| Type checks and unit/process tests | Passed; 29 tests | `npm run check`, `npm test` |
| Provider protocols | Simulated creation, release, failure, and uncertain cleanup passed | `src/test/providers.test.ts` |
| Credential isolation | Private connection file; no provider key in child environment or arguments; connection token redacted | Mock runner test |
| Missing credentials | Exit 2 before output directory or session creation | CLI check using `examples/providers.json` |
| Real browser integration | Defect, screenshot, secret handling, cancellation, and private CDP attachment passed | `.browserlab/integration-1791159252777/` |
| New target format | 40/40 declared outcomes matched on local Chrome and Lightpanda | `.browserlab/providers-local-smoke/results.json` |
| Exported static reference pages | 20/20 declared outcomes matched on local Chrome with a URL path prefix | `.browserlab/exported-fixture-smoke/results.json` |
| Report controls and layout | Provider filters, unexpected-only empty state, custom IDs, and long names checked at desktop and 390px width | Clearly labelled simulated report; no cloud benchmark claims |
| Package contents | `.env.example` included; actual `.env`, run data, and test files excluded | `npm pack --dry-run` |

Actual Browserbase and Browserless acceptance remains pending. Users store their keys locally and run the checks described in [provider setup](providers.md). Protocol mocks and a local CDP connection do not prove live account compatibility, remote cleanup, or provider performance.

## Version 0.3.0 provider expansion

Date: 2026-10-04. This version adds Steel, Browser Use Cloud, Bright Data Browser API, Hyperbrowser, and Anchor. It also adds the shared session lifecycle and the `accept` command.

| Check | Result | Evidence |
| --- | --- | --- |
| Unit, process, and protocol tests | 46 passed | `npm test` |
| Types and diff whitespace | Passed | `npm run check`, `git diff --check` |
| New REST contracts | Create, connection, inspection, stop, and failure cases passed with simulated responses | `src/test/provider-expansion.test.ts` |
| Bright Data connection mechanism | Mock server checks authentication isolation, CDP message routing, access controls, and close acknowledgement | WebSocket protocol tests |
| Real browser integration | All six sections passed, including Chrome through the private WebSocket bridge | `.browserlab/integration-1791160681613/` |
| Local reference suite | 40/40 declared outcomes matched | `.browserlab/providers-seven-smoke/results.json` |
| Acceptance workflow | Successful extraction, negative cases, cancellation, failed cleanup, and output reuse tested with a mock adapter | `src/test/acceptance.test.ts` |
| Missing keys | All seven preflights and the acceptance command reject missing credentials | CLI checks |
| Clean archive install | Version 0.3.0 CLI loaded successfully with the WebSocket dependency | `/tmp/browserlab-package-03` |
| Archive contents | Credential template included; keys, run data, and development tests excluded | `npm pack` manifest |

Live cloud acceptance is **not complete**. No provider keys or local `.env` were available. The acceptance command requires locally supplied keys and a controlled HTTPS fixture host. No cloud sessions were created during this verification. A local Chrome bridge test proves the connection mechanism, not Bright Data's production behavior or billing.

## Installer observation

A fresh engine re-download exceeded the initial three-minute limit. The installer now streams downloads, shows progress, permits ten minutes, and reuses only a binary that matches the publisher's checksum.

The revised installer subsequently completed a fresh download to `/tmp/browserlab-fresh-engine/lightpanda`. Its SHA-256 matched the publisher's manifest: `955440053a84754dd64c62f970449a56a2b350cdf43ea5f2e809a73047b8173d`. A second installation reused that binary after checking its checksum. `browserlab doctor --engines lightpanda`, with `BROWSERLAB_LIGHTPANDA` set to that path, passed startup and cleanup and reported Lightpanda 1.0.0. This verifies the macOS arm64 installation path. The successful GitHub run above also verified fresh installation and both engines on Linux.

The first Linux run exposed Ubuntu's restriction on user namespaces for downloaded Chrome binaries. The workflow now installs a path-scoped AppArmor profile following Chromium's guidance. Chrome's sandbox remains enabled. The subsequent run passed both engine startup checks, all 20 reference cases with three repetitions per engine, and the defect, screenshot, secret-handling, and cancellation integration checks.

## Evidence not yet available

- Tagged release and downloadable release assets. The source repository is public.
- Five customer interviews.
- Three external teams with representative workflows.
- Customer findings from independent report use.

These missing items prevent a claim that all three business stages are complete. Local engineering tests do not replace customer evidence.

Local `.browserlab` files are intentionally excluded from source control. They can be regenerated with the documented commands. Do not present this record as a cross-platform certification or a universal compatibility benchmark.


## Terminal release (0.4.0)

The terminal is the default result interface. HTML requires `--html` or a later `report` command. JSON and JUnit are still written on each completed or cancelled execution.

A scriptc 0.2.2 coverage probe against the 0.3.0 CLI analyzed 979 statements and reported 929 as static (94%). It also reported blocking operations, including WebSocket construction/events, `fs/promises.mkdtemp`, exclusive file writes, and `util.isDeepStrictEqual`. A high static percentage does not mean the app builds. The compiler was installed in a temporary probe directory; it is not a project dependency. See [scriptc limitations](https://scriptc.dev/docs/limitations).

The native launch path uses agent-browser's existing executable. It avoids starting a Node wrapper for each command. Missing or non-executable native binaries fall back to the upstream launcher. Explicit executable overrides remain supported.

Measurements on this Mac, with agent-browser 0.38.2:

| Measurement | Node wrapper | Native launch |
| --- | ---: | ---: |
| Adapter `--version`, median of 30 measured launches after 3 warm-ups | 48.36 ms | 2.67 ms |
| Local heading check on both engines, full run median | 1,524 ms | 968 ms |
| Chrome workflow median, open + extract | 124 ms | 37 ms |
| Lightpanda workflow median, open + extract | 105 ms | 14 ms |

The paired workflow experiment used five measured pairs after one discarded warm-up pair. Mode order alternated. Both modes used the same local fixture, assertions, process sampling, and fresh browser sessions. Full run time includes startup, workflow, cleanup, and JSON writes. It excludes CLI startup and report rendering. All 24 trials, including warm-ups, passed. This is about 36% less wall time for this small workload, not a claim about arbitrary pages or cloud providers. Evidence: `.browserlab/launch-benchmark-1791161482474/summary.json`.

Help startup measured approximately 50 ms after lazy loading, versus 77 ms before (30 samples after 3 warm-ups). These sequential local timings are illustrative; machine load can change them.

Real-engine integration passed: terminal summaries, no HTML by default, later HTML export, page regression and JUnit, screenshots, secret redaction with HTML enabled, SIGINT cleanup, private CDP attachment, and bridge close confirmation. Evidence: `.browserlab/integration-1791161446800/`.

Final local checks: 49 unit/process/protocol tests passed; type checks passed; the full reference demo matched all 40 expected outcomes with zero cleanup errors (`.browserlab/terminal-04-smoke/results.json`). Live cloud acceptance is still pending user-supplied credentials.
