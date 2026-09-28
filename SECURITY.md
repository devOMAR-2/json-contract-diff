# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

Security fixes are released for the latest 1.x version. Please upgrade to the latest release before
reporting an issue.

## Reporting a vulnerability

Please do **not** report security vulnerabilities through public GitHub issues, discussions or pull
requests.

Report them privately instead, using either of these channels:

- **GitHub private vulnerability reporting (preferred):** go to the
  [Security tab](https://github.com/devOMAR-2/json-contract-diff/security) of the repository and click
  **Report a vulnerability**.
- **Email:** [omar.alfarraj@yahoo.com](mailto:omar.alfarraj@yahoo.com)

Please include as much of the following as you can:

- The affected version of `json-contract-diff`, and your Node.js version.
- A description of the vulnerability and its impact.
- Steps to reproduce, ideally a minimal JSON input or code snippet.
- Any suggested fix or mitigation.

## What to expect

- An acknowledgement of your report within **3 business days**.
- An initial assessment, including whether the report is accepted, within **7 days**.
- For accepted reports, a fix released as soon as practical, typically within **30 days** depending on
  complexity. You will be kept informed of progress.
- Credit for the discovery in the release notes and security advisory, unless you prefer to remain
  anonymous.

Please give us a reasonable amount of time to release a fix before disclosing the issue publicly.

## Scope

`json-contract-diff` has no runtime dependencies and performs no network access. The library only
inspects the values passed to it, and the CLI only reads the two files named on its command line.
Reports about denial of service through crafted input (for example extremely deep nesting that bypasses
`maxDepth`) are in scope.
