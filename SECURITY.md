# Security

BrowserLab executes browser workflows on the caller's machine. A workflow can trigger website actions. It is not a sandbox for hostile workflow definitions or page content.

Use controlled websites and test accounts. Do not run unknown suites with privileged credentials. The initial scope is read-only extraction.

Environment values referenced by `fill.env` are redacted from saved text results. This does not remove secrets from screenshots, arbitrary page content, process memory, or upstream engine logs. Review artifacts before sharing them.

BrowserLab does not upload results or send telemetry. The browser engines may have their own network behavior. The runner requests disabled Lightpanda telemetry and uses isolated browser sessions.

Do not place private vulnerability details in a public issue. Once the repository is published, use its private vulnerability-reporting channel if enabled. Until that channel exists, contact the repository owner privately.
