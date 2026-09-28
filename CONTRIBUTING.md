# Contributing to json-contract-diff

Thanks for your interest in improving `json-contract-diff`. Bug reports, documentation fixes and pull
requests are all welcome.

Before starting on a larger change, please [open an issue](https://github.com/devOMAR-2/json-contract-diff/issues)
to discuss it, so that no effort is wasted on something that does not fit the project.

To report a security vulnerability, do not open a public issue. Follow [SECURITY.md](./SECURITY.md)
instead.

## Setup

You need Node.js 20 or later and npm.

```sh
git clone https://github.com/devOMAR-2/json-contract-diff.git
cd json-contract-diff
npm ci
```

## Scripts

| Script                  | What it does                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| `npm run build`         | Removes `dist/` and compiles `src/` to `dist/` with TypeScript.      |
| `npm test`              | Runs the test suite once with Vitest.                                |
| `npm run test:watch`    | Runs the tests in watch mode.                                        |
| `npm run test:coverage` | Runs the tests with coverage. Fails below the configured thresholds. |
| `npm run lint`          | Lints the project with ESLint.                                       |
| `npm run format`        | Formats all files with Prettier.                                     |
| `npm run format:check`  | Checks formatting without writing.                                   |
| `npm run typecheck`     | Type-checks sources, tests and config files without emitting.        |
| `npm run check`         | Runs typecheck, lint, format check, tests with coverage and build.   |

Run `npm run check` before opening a pull request.

To try the CLI locally after a build:

```sh
npm run build
node dist/bin.js old.json new.json
```

## Project structure

```text
src/
  index.ts     Public exports. Anything not exported here is internal.
  types.ts     Public types: Contract, Change, DiffResult, options.
  infer.ts     inferContract: turns a JSON value into a Contract and validates the input.
  contract.ts  Contract helpers: type ordering, merging contracts of array items.
  compare.ts   compareContracts and DEFAULT_SEVERITY: classifies the differences.
  diff.ts      diffJson: infer both values, then compare.
  format.ts    formatDiff and formatChange: plain-text reports.
  path.ts      Path building, e.g. users[].email and headers["content.type"].
  errors.ts    JsonContractError and its error codes.
  cli.ts       Argument parsing, file reading, output and exit codes.
  bin.ts       Executable entry point for the CLI.
tests/         Vitest test suites.
scripts/       Build helpers.
```

## Guidelines

- **Keep the library pure.** Library functions are synchronous, deterministic and free of side effects,
  and never mutate their input. Only `cli.ts` and `bin.ts` touch the file system or the process.
- **No runtime dependencies.** The package ships with zero dependencies. Use Node.js built-ins or write
  the code; development dependencies are fine.
- **Tests are required.** Every bug fix needs a test that fails without the fix, and every feature needs
  tests covering its behavior. Coverage must stay above the thresholds in `vitest.config.ts`.
- **Keep the public API deliberate.** A new export, option or change type is a public API change. Update
  the README and the type documentation along with it.
- **Match the existing style.** Prettier and ESLint are the source of truth for formatting and lint
  rules. TypeScript runs in strict mode.
- **Use [Conventional Commits](https://www.conventionalcommits.org/)** for commit messages, for example:
  - `fix: report type-narrowed for nullable array items`
  - `feat: add --quiet flag to the CLI`
  - `docs: clarify array-items-unknown`

  Mark breaking changes with `!` (`feat!: ...`) or a `BREAKING CHANGE:` footer.

- **Record user-facing changes** under `## [Unreleased]` in [CHANGELOG.md](./CHANGELOG.md).

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests.
3. Run `npm run check`.
4. Open a pull request that explains what changed and why, and links the related issue.

## Release process

Releases are made by the maintainer from an up-to-date `main` branch:

1. Move the entries under `## [Unreleased]` in `CHANGELOG.md` to a new version section with today's
   date, and update the comparison links at the bottom of the file.
2. Commit the changelog: `git commit -am "docs: changelog for vX.Y.Z"`.
3. Bump the version, which also creates the commit and the `vX.Y.Z` tag:
   `npm version <patch|minor|major>`.
4. Publish to npm: `npm publish`. The `prepublishOnly` script runs `npm run check` first, so a release
   cannot be published with failing checks.
5. Push the commit and the tag: `git push --follow-tags`.
6. Create a GitHub release for the tag with the changelog entries.

Versioning follows [Semantic Versioning](https://semver.org/). Changing the default severity of a
change type, or the structure of `DiffResult`, is a breaking change.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
