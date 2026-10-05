# Measurement and comparison

## Controlled dimensions

An engine comparison keeps the task, assertions, input values, adapter version, and host configuration fixed. BrowserLab alternates engine order for each case and repetition. Trials run serially to reduce interference.

The runner creates a fresh session for each trial. There are no warm-session reuse measurements in version 0.1.0. Browser startup and workflow execution have separate timings.

The suite hash includes steps, assertions, test time limits, retry policy, and expected statuses. It excludes engine selection and repetition count. A changed hash blocks direct baseline comparison. The demo uses a stable fixture identity because its local server chooses a new port each run.

## Measurements

- Total time covers startup, version inspection, workflow steps, and assertion evaluation. Cleanup is outside this interval.
- Startup time covers initial browser launch and session identification.
- Workflow time includes CLI process startup, transport, page work, waits, and assertions.
- Step time measures the complete adapter operation.
- Peak RSS sums the session daemon and its observed descendants. Sampling starts after startup and runs approximately every 150 ms.
- Shared RSS pages may be counted more than once. The result is not PSS or a billing measurement.
- CPU sums each observed process's maximum cumulative CPU time. Short-lived processes can be missed. Values are lower bounds.
- Sampling failure produces `null`, not zero.

The HTML report shows all attempts. Medians and p95 values use passing first attempts. A retry never changes the original result. A release with an unexpected first attempt remains failed even if a retry succeeds.

## Baseline rules

The system accepts only complete result sets with expected outcomes and successful cleanup. Acceptance writes a new file. The caller must select a new directory to replace a baseline.

Correctness regressions include an increased unexpected-outcome rate, missing baseline cases/configurations, and cleanup failures. Current unexpected outcomes fail the CLI even when the baseline also had failures.

Performance gates require at least five passing first attempts in each set by default. Both the relative and absolute thresholds must be exceeded. Host metadata differences disable the performance gate. Adapter version changes appear as warnings. Results also record whether agent-browser starts directly or through Node. A change in that launch method disables timing gates because workflow timing includes command startup. Old results with no launch field are treated as Node launches. Correctness gates remain active.

The host signature cannot capture every environmental change. CPU load, thermal limits, background tasks, network conditions, and CI hardware allocation can affect results. Run controlled comparisons on the same machine. A performance gate is a heuristic, not a statistical significance test.

## Correctness and limitations

Chrome is not an oracle. Both engines must satisfy customer assertions. Output differences can remain even when both engines pass. The report flags differences between first passing outputs for review.

Live sites can change between trials. Start with deterministic fixtures. Maintain representative customer workflows separately. Use stable source data or expected-value snapshots where possible.

There are no cloud-cost estimates, automatic migration decisions, or universal compatibility scores in this release. Those require verified resource pricing and representative workload evidence.

## Process lifecycle

Each trial gets a unique session in the `browserlab` namespace. The adapter uses its own configuration and excludes inherited browser configuration. The runner terminates a timed-out CLI process group, then closes the owned browser session.

If graceful closure fails on macOS/Linux, the runner terminates only the recorded session process tree and checks that it is no longer resident. The report identifies forced cleanup. If cleanup cannot be verified, the trial fails the release check. The upstream idle timeout provides a further 30-second fallback.

SIGINT and SIGTERM stop scheduling new trials, close the active session, and save partial results. Abrupt machine termination or SIGKILL cannot guarantee report completion. The next execution uses fresh session identifiers.
