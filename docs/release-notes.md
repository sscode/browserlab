# BrowserLab 0.1.0 alpha

This is the first local, open-source release candidate. It targets read-only browser workflows on macOS and Linux.

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
npm install /absolute/path/to/browserlab-0.1.0.tgz
npx agent-browser install
node node_modules/browserlab/scripts/install-lightpanda.mjs 1.0.0
npx browserlab doctor
npx browserlab demo --repetitions 1
```

Replace the archive path with the supplied file's location. This installs the CLI in the pilot directory. The next two commands install the browser binaries. The Lightpanda installer checks the publisher's checksum. Set `BROWSERLAB_LIGHTPANDA` to use a custom binary path; the installer also uses this path. A source checkout includes the equivalent `npm run install:lightpanda` command.

The archive is separate from the browser binaries. The project name has not been reserved on npm. Do not assume that the public npm package with the same name belongs to this project.
