# CI integration

BrowserLab uses your CI machine. There is no result-upload service or provider key.

## Reference-suite checks

The repository workflow installs pinned dependencies, installs Lightpanda 1.0.0 with a checksum check, and executes the local reference suite. Chrome installation uses agent-browser's installer.

The workflow saves HTML, JSON, and JUnit results even after a failed check. The fixture server uses loopback. No third-party website is part of the required suite.

Ubuntu runners can block the user namespaces that downloaded Chrome builds need for their sandbox. The repository workflow installs an AppArmor profile scoped to agent-browser's downloaded Chrome path. This follows [Chromium's per-path profile guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md). Chrome's sandbox remains enabled. Include the same setup step when you copy this workflow to an Ubuntu runner with this restriction.

## Check your own workflow

1. Add your suite to the repository.
2. Execute it on a controlled CI machine.
3. Review the assertions and results.
4. Accept the result set as a baseline.
5. Commit the reviewed baseline after checking it for private data.
6. Compare future executions with that baseline.

Example job steps, after checkout and Node.js setup:

```yaml
- run: npm ci
- run: npm run build
- run: npx agent-browser install --with-deps
- run: npm run install:lightpanda
- name: Check catalog workflow
  run: >-
    node dist/cli.js run suites/catalog.json
    --baseline baselines/catalog/baseline.json
    --out .browserlab/ci
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: browserlab-results
    path: .browserlab/ci
    include-hidden-files: true
```

Use the same machine class, browser versions, suite, and inputs for performance comparisons. Hosted CI machines can have different load and CPU performance. BrowserLab suppresses timing gates when recorded host metadata differs, but identical metadata does not prove identical machine conditions.

For a correctness-only smoke check, use one repetition. The report will state that performance evidence is insufficient. For performance checks, use at least five repetitions and choose thresholds appropriate to the workload.

## Exit codes and result handling

| Code | Meaning |
| --- | --- |
| 0 | Complete execution with all expected outcomes and no baseline regressions |
| 1 | Unexpected outcome, incomplete saved run, or baseline regression |
| 2 | Invalid input or setup error |
| 130 | Cancelled execution |

JUnit includes assertion failures, execution errors, missing execution coverage, and baseline regressions. Expected negative cases are successful tests with their original status retained in JSON and HTML.

Do not run suites from untrusted pull requests with privileged credentials. A suite can navigate and submit forms. Environment values used by `fill.env` are redacted from text results, but screenshots and private page output still need review.
