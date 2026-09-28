# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-28

Initial release.

### Added

- `diffJson(oldValue, newValue, options?)` compares the structure of two JSON values and classifies
  every contract change as breaking, non-breaking or a warning. Values are ignored; only shapes and
  types are compared.
- `inferContract(value, options?)` infers a serializable structural contract from a JSON value. Array
  elements are merged into a single item contract, so differing types become unions and properties
  missing from some elements become optional.
- `compareContracts(oldContract, newContract, options?)` compares two previously inferred contracts.
- Eight change types: `added`, `removed`, `type-changed`, `type-widened`, `type-narrowed`,
  `required-to-optional`, `optional-to-required` and `array-items-unknown`.
- `DEFAULT_SEVERITY` with defaults that take the consumer's point of view, and a `severity` option to
  override the severity of any change type, including `ignore`.
- `maxDepth` option (default `100`) to reject deeply nested input.
- Deterministic paths such as `users[].email` and `headers["content.type"]`, with changes ordered
  depth-first and object keys sorted.
- `formatDiff(result)` and `formatChange(change)` for plain-text reports without ANSI colors.
- `JsonContractError` with the codes `INVALID_JSON_VALUE`, `CIRCULAR_REFERENCE`,
  `MAX_DEPTH_EXCEEDED` and `INVALID_OPTIONS`.
- `json-contract-diff` CLI with `--json`, `--fail-on breaking|warning|none`, repeatable
  `--severity <type>=<level>`, `--max-depth`, `--help` and `--version`, and exit codes `0` (no
  changes at the `--fail-on` level), `1` (changes found) and `2` (error).
- ESM-only package for Node.js 20+, with TypeScript declarations and zero runtime dependencies.

[Unreleased]: https://github.com/devOMAR-2/json-contract-diff/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/devOMAR-2/json-contract-diff/releases/tag/v1.0.0
