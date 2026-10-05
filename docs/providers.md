# Browserbase and Browserless

BrowserLab can run the same explicit workflow on local Chrome, local Lightpanda, Browserbase, and Browserless. It controls page actions through agent-browser 0.38.2 and manages hosted sessions through the provider APIs.

**Verification status:** provider protocol tests use simulated API responses. Actual cloud execution has not been verified with customer credentials. Do not treat these tests as a live provider benchmark. A real local Chrome integration checks the private CDP connection path.

## Store keys locally

```sh
cp .env.example .env
chmod 600 .env
```

Edit `.env` locally. Set `BROWSERBASE_API_KEY` and `BROWSERLESS_API_KEY`. Browserbase's optional `BROWSERBASE_PROJECT_ID` selects a project; otherwise the service infers it from the key. The repository ignores `.env` files. Never add keys to a suite or commit them.

```sh
npm ci
npm run build
node dist/cli.js doctor --targets browserbase,browserless --env-file .env
node dist/cli.js run examples/providers.json --env-file .env
```

The example includes local Chrome. Install it with `npx agent-browser install`, or remove its target from the suite. The example checks `example.com`, an external page that can change. Use controlled pages for release gates.

Existing environment values take precedence over an environment file. File loading is explicit; BrowserLab does not search for credentials automatically. CLI output and text reports redact known keys and connection tokens. Reports and screenshots can still contain page data.

Remote execution sends navigation and page actions to the selected service and can incur provider charges. Generated reports remain on the local machine. BrowserLab does not upload reports.

## Select targets

Version 1 suites and `--engines chrome,lightpanda` still select local engines. Version 2 uses a `targets` array. Each entry has a unique `id`, a `provider`, an `engine`, and an optional provider `region`. See `examples/providers.json`.

Built-in selections are also available:

```sh
browserlab run browserlab.json --targets chrome,browserbase,browserless --env-file .env
```

`--targets` replaces the suite's target selection with built-in defaults. Use the suite file for custom IDs or regions. Do not combine `--targets` with `--engines`.

| Provider | Engine | Regions | Default |
| --- | --- | --- | --- |
| local | chrome or lightpanda | No region field | Local machine |
| browserbase | chrome | us-west-2, us-east-1, eu-central-1, ap-southeast-1 | us-west-2 |
| browserless | chrome | sfo, lon, ams | sfo |

This version requests no provider proxy and disables optional stealth settings. It does not expose arbitrary provider launch settings. Exact browser versions come from the remote browser when available. Providers control their available versions and infrastructure.

## Controlled remote tests

Cloud browsers cannot reach the local demo server. Export the reference pages and publish them to a controlled HTTPS host:

```sh
browserlab fixtures --out .browserlab/public-fixtures
```

Serve all three generated paths: `index.html`, `next/index.html`, and `api/items`. Preserve directory URLs and the final slash on the fixture base URL. The `api/items` file is static JSON. No backend API is required. The directory contains no keys or run results. BrowserLab does not publish the directory automatically.

```sh
browserlab demo --fixture-url https://YOUR-HOST/fixtures/ \
  --targets chrome,lightpanda,browserbase,browserless \
  --repetitions 1 --env-file .env
```

Each provider creates one session per trial, including negative cases. This command runs 80 trials before retries. Start with the one-case provider example to check account access and charges. The hosted demo has a longer timeout case to allow cloud startup; its contract differs from the local demo.

## Cleanup and failure handling

Browserbase sessions use a bounded timeout, with keep-alive disabled. BrowserLab requests release and checks terminal status. Browserless sessions use a bounded lifetime; BrowserLab checks the stop endpoint's response. A failed stop request fails the trial, and the runner does not retry that trial after a cleanup error.

A process crash or a lost create response can leave an uncertain session. The runner reports this condition when it can and asks the operator to check the provider dashboard. Server-side expiration bounds session lifetime. BrowserLab cannot guarantee cleanup after a hard machine failure.

Connection URLs are stored temporarily in a private file, removed during cleanup. They are not passed as command-line arguments or written into result files. The local adapter process does not receive provider API keys.

## Measurements and baselines

Each target has separate report cards, filters, JUnit names, and baseline coverage. Changing a target's provider or region requires a reviewed baseline. Old local result files remain readable.

Timing is observed by the client and includes network transport and waits. Local client CPU and memory do not represent a remote browser. Remote CPU, memory, and billed cost remain unavailable. There is no inferred price or savings claim.

## Provider contracts

- [Browserbase create session](https://docs.browserbase.com/reference/api/create-a-session)
- [Browserbase release session](https://docs.browserbase.com/reference/api/update-a-session)
- [Browserless Sessions API integration in the pinned adapter](https://github.com/vercel-labs/agent-browser/blob/v0.38.2/cli/src/native/providers.rs)

Live acceptance must cover extraction, deliberate data errors, timeout, cancellation, and successful remote cleanup on both accounts. Confirm those results before calling this provider support production-verified.
