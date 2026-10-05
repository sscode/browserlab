# BrowserLab

**Check browser workflows before you release. Compare local browsers and seven cloud browser providers with the same correctness requirements.**

BrowserLab is an open-source CLI. It executes workflows on selected local or hosted browsers, evaluates assertions, compares repeated trials, and shows results in the terminal. HTML export is optional. Local runs need no account or model API key. Hosted targets need a provider account and key. No result upload is required.

**Status: early alpha.** The adapters use agent-browser 0.38.2. Local Chrome and Lightpanda have real-engine verification. Browserbase, Browserless, Steel, Browser Use Cloud, Bright Data, Hyperbrowser, and Anchor have protocol tests; live provider verification remains pending. This project is independent of those products. Start with read-only workflows and controlled test sites.

## Quick start

Requirements: Node.js 24+, macOS or Linux, Chrome, and Lightpanda. Windows support has not been verified.

From this repository:

```sh
git clone https://github.com/sscode/browserlab.git
cd browserlab
npm ci
npm run build
npx agent-browser install
npm run install:lightpanda
node dist/cli.js doctor
node dist/cli.js demo --repetitions 1
```

Read the result in the terminal. Use `--html` to also create an offline report, or run `browserlab report <results.json>` later. The demo starts its own local website and closes it afterward. It includes 20 cases and needs no external website.

Fourteen cases expect correct extraction. Four cases expect an assertion failure. One expects a selector error. One expects a timeout. The report preserves these actual statuses. An expected negative result does not count as a successful data extraction.

For a reusable `browserlab` command during development:

```sh
npm link
browserlab init
browserlab run browserlab.json
```

The npm name is provisional. This repository does not imply that `npm install browserlab` installs this project. Use a repository checkout or an explicitly supplied release archive until a package is published.

If you received an archive, follow the [archive installation steps](docs/release-notes.md#install-from-a-supplied-archive).

## Cloud providers

Store your own keys locally:

```sh
cp .env.example .env
chmod 600 .env
# Edit .env locally, then:
node dist/cli.js doctor --targets browserbase,browserless --env-file .env
node dist/cli.js run examples/providers.json --targets chrome,browserbase,browserless --env-file .env
```

Supported targets: `browserbase`, `browserless`, `steel`, `browser-use`, `brightdata`, `hyperbrowser`, and `anchor`, plus local `chrome` and `lightpanda`. The command above selects three targets from the full example. Provider sessions can incur charges. Reports stay local.

Use `browserlab accept --targets steel --fixture-url https://YOUR-HOST/fixtures/ --env-file .env` to check live execution and cleanup. See [provider setup and verification limits](docs/providers.md) for credentials, settings, and fixture hosting.

## Your first workflow

```json
{
  "version": 1,
  "name": "Catalog checks",
  "engines": ["chrome", "lightpanda"],
  "repetitions": 5,
  "timeoutMs": 30000,
  "tests": [{
    "id": "heading",
    "name": "Read the page heading",
    "steps": [
      { "action": "open", "url": "https://example.com" },
      { "action": "extract", "as": "heading", "selector": "h1", "kind": "text" }
    ],
    "assertions": [{ "path": "/heading", "op": "equals", "value": "Example Domain" }]
  }]
}
```

Both engines must meet the assertion. Chrome output is not treated as ground truth. Each trial gets a separate browser session. The runner alternates engine order and preserves failed attempts.

See [the suite reference](docs/suites.md) for table extraction, environment variables, and negative tests.

## Save a baseline and check a change

```sh
browserlab run browserlab.json --out .browserlab/before
browserlab baseline accept .browserlab/before/results.json --out baselines/catalog-v1

# After a browser or workflow change:
browserlab run browserlab.json --out .browserlab/after \
  --baseline baselines/catalog-v1/baseline.json
```

The default timing gate requires five passing first attempts in both runs. It fails when median workflow time increases by **more than 25% and more than 100 ms**. Use `--min-samples`, `--max-slowdown`, and `--min-delta` to change these limits.

A change to the test contract requires a reviewed new baseline. Different host configurations disable the timing gate and produce a warning. Correctness checks remain active.

```sh
browserlab compare .browserlab/after/results.json baselines/catalog-v1/baseline.json
browserlab report .browserlab/after/results.json
# Include baseline findings in an HTML export:
browserlab compare .browserlab/after/results.json baselines/catalog-v1/baseline.json --html
```

Baselines never overwrite an existing baseline file. Keep accepted baselines in version control after checking them for sensitive data.

## Reports and CI

Each execution prints trial outcomes, failure details, a target summary, and baseline findings. It also saves:

- `results.json`: measurements, outputs, assertions, and configuration metadata.
- `report.html`: an optional offline report. Use `--html` with `run`, `demo`, `compare`, or `accept`, or use the `report` command.
- `junit.xml`: test outcomes and baseline regressions for CI.
- `comparison.json`: baseline findings, when a baseline was supplied.
- `artifacts/`: screenshots only when the suite requests them.

Exit codes: **0** means all declared outcomes matched; **1** means failed checks or regressions; **2** means a configuration or setup error; **130** means cancellation.

Use the [CI example](docs/ci.md). The [repository workflow](.github/workflows/ci.yml) checks the source and both real engines. Results remain build artifacts; BrowserLab has no hosted result service.

## What the measurements mean

Workflow time includes browser command transport and explicit waits. BrowserLab calls the installed native agent-browser executable directly when it is available. It keeps the upstream Node launcher as a fallback. Results record this choice; changing the launch method disables timing gates until you accept a new baseline. Browser startup has a separate measurement. Statistics use passing first attempts; a successful retry does not erase the original failure.

On macOS and Linux, the runner samples the session daemon and its browser descendants using `ps`. RSS can double-count shared pages. Sampling can miss short peaks. CPU is a sampled lower bound. Unavailable values remain `null`. See [methodology](docs/methodology.md).

These are workload measurements, not universal browser rankings. No cost estimate appears without a defined pricing model. A local timing difference does not directly establish cloud savings.

## Configuration

| Variable | Use |
| --- | --- |
| `BROWSERLAB_CHROME` | Path to a specific Chrome executable |
| `BROWSERLAB_LIGHTPANDA` | Path to a specific Lightpanda executable; also sets the installer destination |
| `BROWSERLAB_AGENT_BROWSER` | Override adapter executable, for development |

The runner uses a dedicated agent-browser namespace and an isolated adapter configuration. Remote connection URLs use private temporary files. It excludes inherited agent-browser configuration and proxy variables. It never connects to your personal browser profile. The Lightpanda installer verifies the publisher's SHA-256 checksum and installs version 1.0.0.

## Scope and limitations

Supported steps: open, click, fill, wait for element presence, extract, and Chrome screenshots. Steps use CSS selectors. A screenshot step is unsupported on Lightpanda and is reported before execution.

BrowserLab does not yet support arbitrary Playwright scripts, browser agents, model evaluations, or automatic engine selection. The [roadmap](docs/roadmap.md) separates engineering progress from customer validation.

Workflows can interact with websites. Read-only use is a scope requirement, not a network security boundary. Do not assume that a click or form submission is harmless. Use controlled environments for repeated actions.

Reports contain extracted website data. Environment values used by `fill.env` are redacted from saved text results. Screenshots and unrelated page data can still contain sensitive information. Review reports before sharing them.

## Help us test the alpha

Try one real extraction workflow. Report the expected output, actual output, engine versions, and the smallest reproduction. Remove credentials and private data first.

The [pilot kit](docs/pilot.md) contains a short evaluation procedure and interview questions. We need real teams to establish whether the product improves release decisions.

## Development

```sh
npm test                 # Validation, assertions, comparison, process and report tests
npm run check            # Type checks
npm run verify:engines   # All 20 cases on both engines
npm pack                # Build an installable archive
```

MIT license. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
