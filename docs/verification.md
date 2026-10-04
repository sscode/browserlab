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

The repeated run used agent-browser 0.38.2, Chrome 154, and Lightpanda 1.0.0. The first version metadata used user-agent strings. A later correction reads exact Chrome metadata through CDP and the Lightpanda version from its binary. Lightpanda's CDP endpoint reports a Chrome compatibility version, which must not be presented as its engine version.

Exact engine checks after that correction: Chrome 154.0.8037.93 and Lightpanda 1.0.0.

The reference suite contains deliberate failures. Matching those expectations proves that the runner detects the selected error conditions. It does not mean that all 200 trials extracted valid data.

## Installer observation

A fresh engine re-download exceeded the initial three-minute limit. The installer now streams downloads, shows progress, permits ten minutes, and reuses only a binary that matches the publisher's checksum. The checksum check against the installed Lightpanda 1.0.0 binary passed. A fresh download through the revised stream path still needs independent verification.

## Evidence not yet available

- Linux CI execution on GitHub. The workflow is prepared but has not run remotely.
- Public repository and release publication.
- Five customer interviews.
- Three external teams with representative workflows.
- Customer findings from independent report use.

These missing items prevent a claim that all three business stages are complete. Local engineering tests do not replace customer evidence.

Local `.browserlab` files are intentionally excluded from source control. They can be regenerated with the documented commands. Do not present this record as a cross-platform certification or a universal compatibility benchmark.
