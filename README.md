# json-contract-diff

Detect breaking and non-breaking changes between the structure of two JSON values. Compares shapes and types, not values.

[![npm version](https://img.shields.io/npm/v/json-contract-diff.svg)](https://www.npmjs.com/package/json-contract-diff)
[![CI](https://github.com/devOMAR-2/json-contract-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/devOMAR-2/json-contract-diff/actions/workflows/ci.yml)
[![CodeQL](https://github.com/devOMAR-2/json-contract-diff/actions/workflows/codeql.yml/badge.svg)](https://github.com/devOMAR-2/json-contract-diff/actions/workflows/codeql.yml)
[![npm downloads](https://img.shields.io/npm/dm/json-contract-diff.svg)](https://www.npmjs.com/package/json-contract-diff)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/json-contract-diff.svg)](https://nodejs.org)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)

```text
$ npx json-contract-diff old.json new.json
JSON Contract Diff

Breaking changes (3)
--------------------
✖ email: property removed (was string)
✖ id: type changed from number to string
✖ orders[].coupon: property removed (was string)

Non-breaking changes (1)
------------------------
+ phone: property added (null)

Warnings (1)
------------
! tags[]: item contract cannot be verified (new array is empty)

Summary: 3 breaking changes, 1 non-breaking change, 1 warning
```

## Contents

- [Why](#why)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Examples](#examples)
- [Structured result](#structured-result)
- [CLI](#cli)
- [Classification rules](#classification-rules)
- [Array behavior](#array-behavior)
- [Null handling](#null-handling)
- [Optional properties](#optional-properties)
- [Path syntax](#path-syntax)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Using it in CI](#using-it-in-ci)
- [ESM only](#esm-only)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

## Why

A regular JSON diff tells you that `"age": 26` became `"age": 27`. For an API response that is noise: the
values change on every request. What your clients actually depend on is the **contract** — which
properties exist and what types they have. A client breaks when `id` turns from a number into a string,
when `email` disappears, or when a field that was always a string suddenly comes back as `null`.

`json-contract-diff` ignores values entirely. It infers the structural contract of two JSON samples,
compares them, and classifies every difference as **breaking**, **non-breaking**, or a **warning**:

- `{ "age": 26 }` and `{ "age": 50 }` have the same contract — no changes.
- `{ "age": 26 }` and `{ "age": "26" }` do not — a breaking `type-changed` change.

The typical use is a CI check: commit a snapshot of an API response, fetch the live response in your
pipeline, and fail the build when the contract changes in a way that would break consumers.

## Installation

```sh
npm install --save-dev json-contract-diff
```

Or run the CLI without installing it:

```sh
npx json-contract-diff old.json new.json
```

Requires Node.js 20 or later. The package has no runtime dependencies.

## Quick start

```js
import { diffJson, formatDiff } from "json-contract-diff";

const before = { id: 1, name: "Omar", email: "omar@example.com" };
const after = { id: "1", name: "Omar", phone: null };

const result = diffJson(before, after);

result.hasBreakingChanges; // true
console.log(formatDiff(result));
```

Output:

```text
JSON Contract Diff

Breaking changes (2)
--------------------
✖ email: property removed (was string)
✖ id: type changed from number to string

Non-breaking changes (1)
------------------------
+ phone: property added (null)

Summary: 2 breaking changes, 1 non-breaking change, 0 warnings
```

`name` changed neither its presence nor its type, so it is not reported.

## Examples

### Nested objects

Objects are compared recursively. Paths use dots:

```js
diffJson(
  { user: { id: 1, profile: { age: 26, city: "Riyadh" } } },
  { user: { id: 1, profile: { age: "26", country: "SA" } } },
);
```

```text
Breaking changes (2)
--------------------
✖ user.profile.age: type changed from number to string
✖ user.profile.city: property removed (was string)

Non-breaking changes (1)
------------------------
+ user.profile.country: property added (string)

Summary: 2 breaking changes, 1 non-breaking change, 0 warnings
```

### Arrays of objects

All elements of an array are merged into a single item contract, addressed with `[]`:

```js
diffJson(
  {
    users: [
      { id: 1, name: "Omar", email: "o@x.com" },
      { id: 2, name: "Sara", email: "s@x.com" },
    ],
  },
  {
    users: [
      { id: 1, name: "Omar" },
      { id: 2, name: null, email: "s@x.com" },
    ],
  },
);
```

```text
Breaking changes (1)
--------------------
✖ users[].name: type widened from string to string | null

Warnings (1)
------------
! users[].email: changed from required to optional

Summary: 1 breaking change, 0 non-breaking changes, 1 warning
```

In the new sample `name` is sometimes `null`, and `email` is missing from one of the users. See
[Array behavior](#array-behavior) and [Optional properties](#optional-properties).

### Nullable fields

`null` is a type like any other. A single sample cannot tell "this field is nullable" apart from "this
field is null right now", so a value that was a string and is now `null` is a type change:

```js
diffJson(
  { nickname: "omar", deletedAt: null },
  { nickname: null, deletedAt: "2026-09-28T10:00:00Z" },
);
```

```text
Breaking changes (2)
--------------------
✖ deletedAt: type changed from null to string
✖ nickname: type changed from string to null

Summary: 2 breaking changes, 0 non-breaking changes, 0 warnings
```

See [Null handling](#null-handling) for how unions such as `string | null` arise.

## Structured result

`diffJson` returns plain data that is easy to assert on or serialize. The quick start example produces:

```json
{
  "hasBreakingChanges": true,
  "breaking": [
    {
      "type": "removed",
      "path": "email",
      "from": "string",
      "severity": "breaking"
    },
    {
      "type": "type-changed",
      "path": "id",
      "from": "number",
      "to": "string",
      "severity": "breaking"
    }
  ],
  "nonBreaking": [
    {
      "type": "added",
      "path": "phone",
      "to": "null",
      "severity": "non-breaking"
    }
  ],
  "warnings": []
}
```

Changes are grouped by severity. Within each group they are ordered deterministically: depth-first, with
object keys in sorted order. The same inputs always produce the same output.

## CLI

```text
Usage: json-contract-diff <old.json> <new.json> [options]

Compare the structure of two JSON files and report contract changes.
Values are ignored; only shapes and types are compared.

Options:
  --json                      Print the result as JSON instead of a text report
  --fail-on <level>           When to exit with code 1:
                                breaking  on breaking changes (default)
                                warning   on breaking changes or warnings
                                none      never
  --severity <type>=<level>   Override the severity of a change type (repeatable),
                              e.g. --severity required-to-optional=breaking
  --max-depth <n>             Maximum nesting depth of the input (default: 100)
  -h, --help                  Show this help
  -v, --version               Show the version

Exit codes:
  0  no changes at the --fail-on level
  1  changes found at the --fail-on level
  2  invalid input or runtime error
```

Given `old.json`:

```json
{
  "id": 1,
  "name": "Omar",
  "email": "omar@example.com",
  "tags": ["admin"],
  "orders": [
    { "id": 10, "total": 25.5, "coupon": "SAVE5" },
    { "id": 11, "total": 12 }
  ]
}
```

and `new.json`:

```json
{
  "id": "1",
  "name": "Omar",
  "phone": null,
  "tags": [],
  "orders": [{ "id": 10, "total": 25.5 }]
}
```

```text
$ json-contract-diff old.json new.json
JSON Contract Diff

Breaking changes (3)
--------------------
✖ email: property removed (was string)
✖ id: type changed from number to string
✖ orders[].coupon: property removed (was string)

Non-breaking changes (1)
------------------------
+ phone: property added (null)

Warnings (1)
------------
! tags[]: item contract cannot be verified (new array is empty)

Summary: 3 breaking changes, 1 non-breaking change, 1 warning
$ echo $?
1
```

`orders[].coupon` is reported as removed (not as `required-to-optional`) because it was optional in the
old sample — present on only one order — and is now absent from every order.

Overriding severities, repeatable:

```text
$ json-contract-diff old.json new.json --severity type-changed=warning --severity removed=ignore
JSON Contract Diff

Non-breaking changes (1)
------------------------
+ phone: property added (null)

Warnings (2)
------------
! id: type changed from number to string
! tags[]: item contract cannot be verified (new array is empty)

Summary: 0 breaking changes, 1 non-breaking change, 2 warnings
$ echo $?
0
```

With `--json`, the CLI prints the [structured result](#structured-result) (pretty-printed, two-space
indentation) instead of the text report. Exit codes are the same.

### Exit codes

| Code | Meaning                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------- |
| `0`  | No changes at the `--fail-on` level. Non-breaking changes never cause a failure.                         |
| `1`  | Changes found at the `--fail-on` level.                                                                  |
| `2`  | Invalid usage, unreadable file, invalid JSON, invalid option, or input nested deeper than `--max-depth`. |

Errors are printed to stderr, prefixed with `error:`:

```text
$ json-contract-diff old.json missing.json
error: cannot read "missing.json": file not found
$ echo $?
2
```

A UTF-8 byte order mark at the start of a file is ignored.

### Why `--fail-on` and not `--fail-on-breaking`

Failing on breaking changes is already the default, so a `--fail-on-breaking` flag would do nothing. The
useful switches go in the other directions: stricter (`--fail-on warning`, which also fails on warnings)
and report-only (`--fail-on none`, which always exits `0` unless an error occurs). A single option with
three levels expresses all of them without flags that contradict each other.

## Classification rules

Every difference is one of eight change types. Each type has a default severity:

| Change type            | Default severity | Example                                 | Why                                                                                                                                                                       |
| ---------------------- | ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `added`                | non-breaking     | `phone` appears                         | Clients ignore properties they do not know about.                                                                                                                         |
| `removed`              | breaking         | `email` disappears                      | Clients that read the property get `undefined`.                                                                                                                           |
| `type-changed`         | breaking         | `number` → `string`                     | At least one type the client handled is gone and an unknown one appeared.                                                                                                 |
| `type-widened`         | breaking         | `string` → `string \| null`             | Every old type is still allowed, but clients now receive a type they may not handle, typically an unexpected `null`.                                                      |
| `type-narrowed`        | non-breaking     | `string \| null` → `string`             | Clients receive a subset of what they already handled.                                                                                                                    |
| `required-to-optional` | warning          | present on every item → missing on some | Clients may break on a missing property, but optionality is inferred from samples: a different sample might have included the property. Worth a look, not a hard failure. |
| `optional-to-required` | non-breaking     | missing on some items → present on all  | Clients already handled the property being absent.                                                                                                                        |
| `array-items-unknown`  | warning          | `[{ … }]` → `[]`                        | The new array was only seen empty, so its item contract cannot be verified.                                                                                               |

The defaults take the **consumer's point of view**: the JSON is produced by a server and read by
clients (an API response), so anything a client may not handle is breaking.

For **request payloads** the roles are reversed — clients produce the JSON and the server reads it. A
new property the server now expects breaks old clients that do not send it, and a property that becomes
required breaks clients that omit it. Flip the defaults with the `severity` option:

```js
const REQUEST_SEVERITY = {
  added: "breaking",
  removed: "non-breaking", // assuming the server ignores unknown properties
  "type-widened": "non-breaking",
  "type-narrowed": "breaking",
  "required-to-optional": "non-breaking",
  "optional-to-required": "breaking",
};

diffJson(oldPayload, newPayload, { severity: REQUEST_SEVERITY });
```

```sh
json-contract-diff old-request.json new-request.json \
  --severity added=breaking \
  --severity optional-to-required=breaking
```

## Array behavior

- **Items are merged into one item contract.** All elements of an array are combined into a single
  contract that accepts every one of them. Differing types become a union (`[1, "a"]` has items of type
  `string | number`), and properties missing from some objects become optional.
- **The `[]` path segment** stands for "every array item": `users[].email`, `matrix[][]`. Individual
  indexes never appear in change paths.
- **Length and values are never compared.** `{ "items": [1, 2, 3] }` and `{ "items": [42] }` have the
  same contract. Item order does not matter either.
- **Empty arrays have unknown items.** An array that was only ever observed empty has a contract of
  `{ "types": ["array"] }` with no `items`.
- **`array-items-unknown`.** When the old array had items and the new one is empty, the item contract
  cannot be verified, so a warning is reported instead of guessing:

  ```text
  ! items[]: item contract cannot be verified (new array is empty)
  ```

  In the opposite direction — the old array was empty and the new one has items — there is no old item
  contract to compare against, and nothing is reported.

## Null handling

`null` is one of the six JSON types (`object`, `array`, `string`, `number`, `boolean`, `null`). A
contract lists every type observed at a position, so nullability is simply `null` appearing in that
list.

| Old              | New              | Change          | Default severity |
| ---------------- | ---------------- | --------------- | ---------------- |
| `string`         | `null`           | `type-changed`  | breaking         |
| `null`           | `string`         | `type-changed`  | breaking         |
| `string`         | `string \| null` | `type-widened`  | breaking         |
| `string \| null` | `string`         | `type-narrowed` | non-breaking     |
| `object`         | `object \| null` | `type-widened`  | breaking         |

A single JSON value has exactly one type per position, so unions like `string | null` are inferred from
**arrays**, where several elements are observed at the same position:

```js
diffJson({ tags: ["admin", "staff"] }, { tags: ["admin", null] });
// breaking      tags[]: type widened from string to string | null

diffJson({ tags: ["admin", null] }, { tags: ["admin"] });
// non-breaking  tags[]: type narrowed from string | null to string
```

When an object is nullable (`object | null`), its properties are still compared. When a value changes
from an object to something that is not an object (for example `null` or an array), only the type change
is reported, not the removal of each property.

## Optional properties

A property is **required** when it was present on every object observed at that position, and
**optional** otherwise.

- Optionality only arises from **arrays**. A single object is one observation, so every property on it
  is required. You cannot learn that a field is optional from one object.
- `required-to-optional` defaults to a **warning**, not breaking, because optionality is sample-based:
  one element lacking a field in today's sample does not prove the API stopped guaranteeing it.
  Promote it with `severity: { "required-to-optional": "breaking" }` if your samples are representative.
- "Required" is relative to the **objects** observed. In `[{ "a": 1 }, null]`, `a` is required: the only
  object seen had it. The `null` element makes the items `object | null`; it does not make `a` optional.

```js
diffJson(
  { users: [{ id: 1, email: "a@x.com" }, { id: 2 }] },
  {
    users: [
      { id: 1, email: "a@x.com" },
      { id: 2, email: "b@x.com" },
    ],
  },
);
// non-breaking  users[].email: changed from optional to required
```

## Path syntax

Every change carries a `path` that points at the location in the JSON:

| Path                      | Meaning                                                |
| ------------------------- | ------------------------------------------------------ |
| `user.profile.age`        | Object keys joined with dots.                          |
| `users[].email`           | `[]` means "every item of the array".                  |
| `matrix[][]`              | Items of items (nested arrays).                        |
| `headers["x.request.id"]` | A key written as a quoted bracket.                     |
| `""`                      | The root value, displayed as `(root)` in text reports. |

Keys that are empty or contain `.`, `[`, `]`, `"` or whitespace are written as quoted brackets, using
JSON string syntax, so paths are never ambiguous. Other characters, such as `-`, are left as they are:

```text
headers[""]: property removed (was number)
headers.content-type: property removed (was string)
headers["user agent"]: property removed (was string)
headers["x.request.id"]: property removed (was string)
```

A change at the root has the path `""`:

```text
(root): type changed from number to string
```

Errors thrown for invalid input use the same syntax, with concrete indexes instead of `[]`, e.g.
`users[2].createdAt`.

## Configuration

`diffJson` accepts two options:

| Option     | Type                                    | Default | Description                                                                            |
| ---------- | --------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `severity` | `Partial<Record<ChangeType, Severity>>` | `{}`    | Overrides the severity of individual change types. Unlisted types keep their default.  |
| `maxDepth` | `number`                                | `100`   | Maximum nesting depth of objects and arrays. Deeper input throws `MAX_DEPTH_EXCEEDED`. |

A severity is one of `"breaking"`, `"non-breaking"`, `"warning"` or `"ignore"`. `"ignore"` drops the
change from the result entirely.

```js
diffJson(oldValue, newValue, {
  severity: {
    "required-to-optional": "breaking",
    "array-items-unknown": "ignore",
  },
  maxDepth: 50,
});
```

Unknown change types and unsupported severities throw a `JsonContractError` with code
`INVALID_OPTIONS`, so a typo never silently falls back to a default. An entry set to `undefined`, and
a `severity` or options argument of `undefined` or `null`, is treated as unset.

**Why one severity map instead of options like `classifyAddedAsBreaking`?** Every change type has the
same four possible outcomes, so a single map keyed by change type covers every combination with one
concept to learn. It is also exactly what `DEFAULT_SEVERITY` exports and what the CLI's `--severity`
flag sets, and a new change type in a future version will not need a new option.

`maxDepth` counts nested containers: the root object or array is depth 1. It exists to reject
pathological input with a clear error instead of a stack overflow. Values far above the default (in
the thousands) can exceed the JavaScript call stack and throw a `RangeError` instead.

## API reference

```ts
import {
  diffJson,
  inferContract,
  compareContracts,
  formatDiff,
  formatChange,
  DEFAULT_SEVERITY,
  JsonContractError,
} from "json-contract-diff";
```

All functions are pure and synchronous. Inputs are never mutated.

### `diffJson(oldValue, newValue, options?)`

```ts
function diffJson(oldValue: unknown, newValue: unknown, options?: DiffOptions): DiffResult;

interface DiffOptions {
  maxDepth?: number; // default 100
  severity?: Partial<Record<ChangeType, Severity>>;
}
```

Infers the contract of both values and compares them. Equivalent to
`compareContracts(inferContract(oldValue), inferContract(newValue), options)`, except that error
messages name the "old value" or "new value".

Throws `JsonContractError` if either value is not JSON-compatible or an option is invalid.

### `inferContract(value, options?)`

```ts
function inferContract(value: unknown, options?: InferOptions): Contract;

interface InferOptions {
  maxDepth?: number; // default 100
}
```

Infers the structural contract of a JSON-compatible value. Values are ignored; only types and structure
are recorded.

```js
inferContract({ id: 1, tags: ["a"], owner: null });
```

```json
{
  "types": ["object"],
  "properties": {
    "id": { "required": true, "contract": { "types": ["number"] } },
    "owner": { "required": true, "contract": { "types": ["null"] } },
    "tags": {
      "required": true,
      "contract": { "types": ["array"], "items": { "types": ["string"] } }
    }
  }
}
```

A contract is plain, serializable data. You can store it with `JSON.stringify` and compare against it
later with `compareContracts`, instead of keeping a full sample response around.

### `compareContracts(oldContract, newContract, options?)`

```ts
function compareContracts(
  oldContract: Contract,
  newContract: Contract,
  options?: CompareOptions,
): DiffResult;

interface CompareOptions {
  severity?: Partial<Record<ChangeType, Severity>>;
}
```

Compares two contracts and classifies every structural difference. Throws `JsonContractError` with code
`INVALID_OPTIONS` for unknown change types or severities in `options.severity`. The contracts
themselves are not validated: pass contracts returned by `inferContract` (or stored with
`JSON.stringify` and parsed back).

### `formatDiff(result)`

```ts
function formatDiff(result: DiffResult): string;
```

Renders a result as the plain-text report shown throughout this README. There are no ANSI colors, so it
is safe for CI logs. Sections with no changes are omitted, and the output always ends with a newline.
When there are no changes it reads:

```text
JSON Contract Diff

No contract changes detected.
```

### `formatChange(change)`

```ts
function formatChange(change: Change): string;
```

Describes a single change in one line, e.g. `id: type changed from number to string`. Useful for custom
reports:

| Change type            | Output                                                           |
| ---------------------- | ---------------------------------------------------------------- |
| `added`                | `phone: property added (null)`                                   |
| `removed`              | `email: property removed (was string)`                           |
| `type-changed`         | `id: type changed from number to string`                         |
| `type-widened`         | `users[].name: type widened from string to string \| null`       |
| `type-narrowed`        | `tags[]: type narrowed from string \| null to string`            |
| `required-to-optional` | `users[].email: changed from required to optional`               |
| `optional-to-required` | `users[].email: changed from optional to required`               |
| `array-items-unknown`  | `items[]: item contract cannot be verified (new array is empty)` |

### `DEFAULT_SEVERITY`

```ts
const DEFAULT_SEVERITY: Readonly<Record<ChangeType, Severity>>;
```

The frozen default severity map:

```js
{
  added: "non-breaking",
  removed: "breaking",
  "type-changed": "breaking",
  "type-widened": "breaking",
  "type-narrowed": "non-breaking",
  "required-to-optional": "warning",
  "optional-to-required": "non-breaking",
  "array-items-unknown": "warning",
}
```

### `JsonContractError`

The only error type the library throws for invalid input or options.

```ts
class JsonContractError extends Error {
  readonly name: "JsonContractError";
  readonly code: JsonContractErrorCode;
  /** Where in the input the problem was found, e.g. "users[3].createdAt". "" is the root. Absent for option errors. */
  readonly path: string | undefined;
}

type JsonContractErrorCode =
  "INVALID_JSON_VALUE" | "CIRCULAR_REFERENCE" | "MAX_DEPTH_EXCEEDED" | "INVALID_OPTIONS";
```

| Code                 | Thrown when                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_JSON_VALUE` | The input contains something JSON cannot represent: `undefined`, functions, symbols, bigints, `NaN`/`Infinity`, sparse arrays, `Date`, `Map`, `Set`, class instances and other objects with a custom prototype. |
| `CIRCULAR_REFERENCE` | The input references itself.                                                                                                                                                                                    |
| `MAX_DEPTH_EXCEEDED` | The input is nested deeper than `maxDepth`.                                                                                                                                                                     |
| `INVALID_OPTIONS`    | `maxDepth` is not a positive integer, `severity` is not an object, or `severity` has an unknown change type or an unsupported severity.                                                                         |

```js
import { diffJson, JsonContractError } from "json-contract-diff";

try {
  diffJson({ createdAt: "2026-09-28" }, { createdAt: new Date() });
} catch (error) {
  if (error instanceof JsonContractError) {
    error.code; // "INVALID_JSON_VALUE"
    error.path; // "createdAt"
    error.message; // 'The new value is not JSON-compatible at "createdAt": Date instance is not a plain JSON object.'
  }
}
```

Values produced by `JSON.parse` are always JSON-compatible; only `maxDepth` can reject them. Objects
created with `Object.create(null)`, and plain objects created in another realm (a `vm` context or a
test environment such as Jest's), are accepted as plain objects. An object that inherits from anything
else, such as `Object.create({})`, is rejected as an "object with a custom prototype".

### Types

All types are exported. The core shapes:

```ts
type JsonType = "object" | "array" | "string" | "number" | "boolean" | "null";

interface Contract {
  /** Never empty, always in the order object, array, string, number, boolean, null. */
  readonly types: readonly JsonType[];
  /** Present if and only if `types` includes "object". Keys are sorted. */
  readonly properties?: Readonly<Record<string, PropertyContract>>;
  /** Present when `types` includes "array" and at least one element was observed. */
  readonly items?: Contract;
}

interface PropertyContract {
  /** true when the property was present on every object observed at this position. */
  readonly required: boolean;
  readonly contract: Contract;
}

type ChangeType =
  | "added"
  | "removed"
  | "type-changed"
  | "type-widened"
  | "type-narrowed"
  | "required-to-optional"
  | "optional-to-required"
  | "array-items-unknown";

type Severity = "breaking" | "non-breaking" | "warning" | "ignore";
type ReportedSeverity = Exclude<Severity, "ignore">;

/** A single change. Discriminate on `type`. */
type Change =
  | { type: "added"; path: string; severity: ReportedSeverity; to: string }
  | { type: "removed"; path: string; severity: ReportedSeverity; from: string }
  | { type: "type-changed"; path: string; severity: ReportedSeverity; from: string; to: string }
  | { type: "type-widened"; path: string; severity: ReportedSeverity; from: string; to: string }
  | { type: "type-narrowed"; path: string; severity: ReportedSeverity; from: string; to: string }
  | { type: "required-to-optional"; path: string; severity: ReportedSeverity }
  | { type: "optional-to-required"; path: string; severity: ReportedSeverity }
  | { type: "array-items-unknown"; path: string; severity: ReportedSeverity };

interface DiffResult {
  readonly hasBreakingChanges: boolean;
  readonly breaking: readonly Change[];
  readonly nonBreaking: readonly Change[];
  readonly warnings: readonly Change[];
}
```

`from` and `to` describe types as a string joined with `|`, e.g. `"string"` or `"object | null"`. All
fields are `readonly`. Each `Change` member is also exported under its own name: `AddedChange`,
`RemovedChange`, `TypeChangedChange`, `TypeWidenedChange`, `TypeNarrowedChange`,
`RequiredToOptionalChange`, `OptionalToRequiredChange` and `ArrayItemsUnknownChange`. The option types
`DiffOptions`, `InferOptions` and `CompareOptions` and the error code type `JsonContractErrorCode` are
exported as well.

## Using it in CI

### GitHub Actions

Commit a snapshot of a known-good response (for example `contracts/user.json`), then diff the live
response against it on every push:

```yaml
- name: Check the /users/:id response contract
  run: |
    curl --fail --silent --show-error https://api.example.com/v1/users/1 --output response.json
    npx json-contract-diff contracts/user.json response.json
```

The step fails (exit code `1`) when a breaking change is found, and prints the report to the job log.
Add `--fail-on warning` to be stricter, or `--fail-on none` to only report. When a change is intended,
update the snapshot in the same pull request that makes it.

With `json-contract-diff` in your `devDependencies`, `npx` uses the installed version. Otherwise pin a
major version, e.g. `npx json-contract-diff@1`.

### Test runners

The same check as a Vitest test:

```ts
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { diffJson, formatDiff } from "json-contract-diff";

test("GET /users/:id keeps its response contract", async () => {
  const snapshot = JSON.parse(await readFile("contracts/user.json", "utf8"));
  const response = await fetch("http://localhost:3000/v1/users/1").then((res) => res.json());

  const result = diffJson(snapshot, response);

  expect(result.breaking, formatDiff(result)).toEqual([]);
});
```

On failure, the text report is the assertion message, followed by a diff of the breaking changes:

```text
AssertionError: JSON Contract Diff

Breaking changes (3)
--------------------
✖ email: property removed (was string)
✖ id: type changed from number to string
✖ orders[].coupon: property removed (was string)
...
: expected [ { type: 'removed', …(3) }, …(2) ] to deeply equal []
```

In Jest, `expect` takes no message argument; use `expect(result.breaking).toEqual([])`, which still
prints every breaking change in the failure diff.

## ESM only

`json-contract-diff` is published as an ES module and requires Node.js 20 or later.

```js
import { diffJson } from "json-contract-diff";
```

CommonJS projects can load it with `require()` on Node.js 20.19+ and 22.12+, which support
`require(esm)` without a flag:

```js
const { diffJson } = require("json-contract-diff");
```

On older Node.js versions, use a dynamic `import()`. TypeScript declarations are included.

## Limitations

- **Inference is sample-based.** The contract reflects what the samples contain, not what the API
  promises. A field that happens to be `null` in one response and a string in the other is reported as
  a type change. Use representative samples, or arrays with several varied items.
- **Optionality cannot be learned from one object.** Every property of a single object is required.
  Optional properties are only detected across array items.
- **No integer versus float distinction.** JSON has a single number type; `1` and `1.5` are both
  `number`.
- **No string formats or enums.** `"2026-09-28"` and `"hello"` are both `string`, and a new enum value
  is not detected.
- **Empty arrays tell nothing about their items.** See [Array behavior](#array-behavior).
- **No JSON Schema or OpenAPI input yet.** Both sides are inferred from JSON values (or contracts you
  inferred and stored earlier).
- **Object key order is ignored.** `{ "a": 1, "b": 2 }` and `{ "b": 2, "a": 1 }` have the same
  contract.
- **The CLI reads files.** Fetch remote responses first, for example with `curl`, as shown in
  [Using it in CI](#using-it-in-ci).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development setup, scripts
and guidelines. To report a security issue, follow [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © 2026 Omar Alfarraj
