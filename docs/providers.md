# Cloud browser providers

BrowserLab can run the same explicit workflow on local Chrome, local Lightpanda, and seven hosted browser services. It uses agent-browser 0.38.2 for page actions. BrowserLab owns each hosted session's lifecycle.

**Verification status:** provider API tests use simulated responses. Live acceptance is pending for all seven services. Real local Chrome tests verify private CDP attachment and the WebSocket bridge. These checks do not prove live account compatibility or provider performance.

## Store keys locally

```sh
cp .env.example .env
chmod 600 .env
```

Edit `.env` on your machine. Set only the credentials for the targets you select. The repository ignores `.env` files. Do not put keys in suites or commit them.

| Target | Local variables |
| --- | --- |
| `browserbase` | `BROWSERBASE_API_KEY`; optional `BROWSERBASE_PROJECT_ID` |
| `browserless` | `BROWSERLESS_API_KEY` |
| `steel` | `STEEL_API_KEY` |
| `browser-use` | `BROWSER_USE_API_KEY` |
| `brightdata` | `BRIGHT_DATA_BROWSER_USERNAME`, `BRIGHT_DATA_BROWSER_PASSWORD` |
| `hyperbrowser` | `HYPERBROWSER_API_KEY` |
| `anchor` | `ANCHOR_API_KEY` |

Bright Data requires Browser API **zone credentials**, not a general account API key. Browser Use selects its browser infrastructure, not its hosted agent service. No model key is needed.

```sh
npm ci
npm run build
node dist/cli.js doctor --targets steel --env-file .env
node dist/cli.js run examples/providers.json --targets chrome,steel --env-file .env
```

The example file includes local Chrome and all seven providers. `--targets` limits the selection. Without this option, the example requires all provider credentials. Install local Chrome with `npx agent-browser install` if you select it.

Existing environment values take precedence over `.env`. File loading is explicit. BrowserLab does not search credential stores or upload keys to a BrowserLab service. Each provider receives its own credentials for authentication. Hosted execution sends page actions and data to that provider and can incur charges. Generated reports remain local.

## Targets and settings

Version 1 suites and `--engines chrome,lightpanda` still select local engines. Version 2 uses `targets`, each with a unique `id`, `provider`, `engine`, and optional `region`. All hosted targets currently use Chrome-compatible browsers.

`--targets` replaces the suite's selection with built-in defaults. Use a suite file for custom IDs or supported regions. Do not combine `--targets` with `--engines`.

| Provider | Browser region | Proxy | Stealth |
| --- | --- | --- | --- |
| Browserbase | `us-west-2` default; `us-east-1`, `eu-central-1`, `ap-southeast-1` | Requested off | Base behavior provider-managed; advanced stealth requested off |
| Browserless | `sfo` default; `lon`, `ams` | No proxy requested | Requested off |
| Steel | `us-east` | Requested off | Provider-managed fingerprinting |
| Browser Use | Provider-managed | Explicitly disabled | Provider-managed |
| Bright Data | Provider-managed | Provider-managed | Provider-managed |
| Hyperbrowser | `us` default; `us-central`, `us-west`, `us-east`, `asia-south`, `europe-west` | Requested off | Standard and ultra stealth requested off |
| Anchor | Provider-managed | Requested off | Extra stealth requested off; base behavior is provider-managed |

Region availability can depend on the account plan. Browser region and proxy location are different settings. The CLI rejects region overrides for providers whose browser region it cannot configure. Steel's current documentation limits browser execution to `us-east`.

Result configurations record requested region, proxy and stealth policy, session-timeout policy, and settings version. These are requested policies, not independent proof of the provider's implementation. `provider-managed` must not be read as `false`. Exact browser versions are read through CDP when available.

## Controlled test pages

Cloud browsers need reachable HTTPS pages. Export the reference pages:

```sh
node dist/cli.js fixtures --out .browserlab/public-fixtures
```

Publish that directory on a controlled HTTPS host. Serve `index.html`, `next/index.html`, and `api/items`. Preserve directory URLs and their final slash. `api/items` is static JSON; no backend API is required. BrowserLab does not publish the pages automatically.

## Live acceptance

Start with the providers already added in version 0.2:

```sh
node dist/cli.js accept --targets browserbase,browserless \
  --fixture-url https://YOUR-HOST/fixtures/ --env-file .env \
  --out .browserlab/accept-first
```

Then check each new provider:

```sh
node dist/cli.js accept --targets steel,browser-use,brightdata,hyperbrowser,anchor \
  --fixture-url https://YOUR-HOST/fixtures/ --env-file .env \
  --out .browserlab/accept-next
```

Acceptance starts **six sessions per provider**: two successful extractions, an incorrect-value assertion, an invalid selector, a workflow timeout, and cancellation after navigation. It requires a browser version, expected outcomes, and confirmed cleanup for each session. Setup failures cannot satisfy negative tests. An invalid-selector test must fail at extraction, not navigation.

The command writes `acceptance.json` and separate HTML, JSON, and JUnit reports for each provider's workflow and cancellation runs. Exit 0 means acceptance passed. Exit 1 means a check failed. Exit 2 means configuration or setup prevented execution. External cancellation returns 130. The intentional cancellation report contains a cancelled trial; the top-level acceptance result evaluates it as a required check.

Run the full reference suite after acceptance:

```sh
node dist/cli.js demo --fixture-url https://YOUR-HOST/fixtures/ \
  --targets chrome,steel --repetitions 1 --env-file .env
```

Each selected target runs 20 trials per repetition. This command runs 40 trials. The hosted demo allows more startup time than the local demo, so their contracts differ.

## Session lifecycle and cleanup

Every adapter exposes `create`, `connect`, `inspect`, and `stop`. Inspection returns `active`, `stopped`, or `unknown`; unsupported inspection is never represented as a confirmed state.

- Browserbase requests release and checks terminal status.
- Browserless checks its session-specific stop endpoint. Its session API does not provide the same status inspection contract.
- Steel requests release and checks for `released` or `failed`.
- Browser Use sends the explicit browser stop action and checks `stopped`. Disconnecting the client alone is insufficient.
- Hyperbrowser requires an acknowledged stop and checks `closed`. `close-error` is not a successful stop.
- Anchor checks the documented response from deleting that specific active session. This operation ends the browser; it does not purge account history.
- Bright Data uses one authenticated WebSocket connection per trial. A private loopback bridge keeps zone credentials out of the adapter. It sends `Browser.close` over that same connection. Only a successful CDP response produces `cdp-confirmed`; a dropped connection fails cleanup. This evidence does not independently verify billing or the provider dashboard.

A failed stop fails the trial and prevents its retry. Session creation is never retried automatically. A lost create response can leave an uncertain session; check the provider dashboard if this occurs.

The REST adapters request bounded server-side lifetimes. Bright Data has a local lifetime bound; this integration cannot set a server-side lifetime. A process or machine crash can prevent explicit cleanup. BrowserLab does not claim otherwise.

Connection files use private permissions and are deleted during cleanup. CLI output and text reports redact known keys and connection tokens. The adapter environment and command arguments contain no provider keys. The private connection file can contain a credential-bearing CDP URL when the provider requires it. Reports and screenshots can still contain page data.

## Measurements and baselines

Each target has separate report cards, filters, JUnit names, and baseline coverage. Changing provider, region, or recorded settings policy requires a reviewed baseline. The explicit settings policy in version 0.3 also requires a new baseline for older hosted runs. Local version 1 results remain readable and comparable.

Timing is observed by the client and includes network transport and waits. Providers can perform internal retries or page processing. Remote CPU, memory, and billed cost are not collected. Do not interpret client CPU or memory as remote browser usage, or compare provider timing without reviewing their different settings.

## API references

Contracts checked on 2026-10-04:

- [Browserbase session API](https://docs.browserbase.com/reference/api/create-a-session)
- [Browserless Sessions API integration in pinned agent-browser](https://github.com/vercel-labs/agent-browser/blob/v0.38.2/cli/src/native/providers.rs)
- [Steel session lifecycle](https://docs.steel.dev/overview/sessions-api/session-lifecycle) and [official SDK](https://github.com/steel-dev/steel-node/blob/main/src/resources/sessions/sessions.ts)
- [Browser Use v4 OpenAPI](https://docs.browser-use.com/cloud/openapi/v4.json)
- [Bright Data Browser API](https://docs.brightdata.com/products/scraping-browser/faqs)
- [Hyperbrowser create](https://hyperbrowser.ai/docs/api-reference/create-new-session), [inspect](https://hyperbrowser.ai/docs/api-reference/get-session-by-id), and [stop](https://hyperbrowser.ai/docs/api-reference/stop-a-session)
- [Anchor create](https://docs.anchorbrowser.io/api-reference/browser-sessions/start-browser-session) and [stop](https://docs.anchorbrowser.io/api-reference/browser-sessions/end-browser-session)
