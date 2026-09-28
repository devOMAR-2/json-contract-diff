/**
 * The six types a JSON value can have.
 */
export type JsonType = "object" | "array" | "string" | "number" | "boolean" | "null";

/**
 * The structural contract of a JSON value: which types it may have and, for
 * objects and arrays, the contracts of their contents.
 *
 * A contract is plain, serializable data, so it can be stored and compared later.
 *
 * - `types` is never empty and is always sorted in a fixed order
 *   (`object`, `array`, `string`, `number`, `boolean`, `null`). More than one
 *   entry means the value was observed with several types, e.g. `string | null`.
 * - `properties` is present if and only if `types` includes `"object"`.
 * - `items` is present when `types` includes `"array"` and at least one array
 *   element was observed. An array that was only ever seen empty has no `items`.
 */
export interface Contract {
  readonly types: readonly JsonType[];
  readonly properties?: Readonly<Record<string, PropertyContract>>;
  readonly items?: Contract;
}

/**
 * The contract of a single object property.
 *
 * `required` is `true` when the property was present on every object observed
 * at this position. It is only ever `false` when several objects were observed
 * (for example the elements of an array) and some of them lacked the property.
 */
export interface PropertyContract {
  readonly required: boolean;
  readonly contract: Contract;
}

/**
 * Every kind of change the comparison can report.
 *
 * - `added`: a property exists only in the new contract.
 * - `removed`: a property exists only in the old contract.
 * - `type-changed`: the value's types changed incompatibly (e.g. `number` to `string`).
 * - `type-widened`: the new contract allows every old type plus more (e.g. `string` to `string | null`).
 * - `type-narrowed`: the new contract allows a strict subset of the old types (e.g. `string | null` to `string`).
 * - `required-to-optional`: a property that was always present is now sometimes missing.
 * - `optional-to-required`: a property that was sometimes missing is now always present.
 * - `array-items-unknown`: the old array had items but the new one was only observed empty,
 *   so its item contract cannot be verified.
 */
export type ChangeType =
  | "added"
  | "removed"
  | "type-changed"
  | "type-widened"
  | "type-narrowed"
  | "required-to-optional"
  | "optional-to-required"
  | "array-items-unknown";

/**
 * How a change is classified. `ignore` drops the change from the result entirely.
 */
export type Severity = "breaking" | "non-breaking" | "warning" | "ignore";

/**
 * The severities a change can carry in a {@link DiffResult}.
 */
export type ReportedSeverity = Exclude<Severity, "ignore">;

interface BaseChange<T extends ChangeType> {
  readonly type: T;
  /**
   * Location of the change, e.g. `user.profile.age` or `users[].email`.
   * `[]` stands for "every array item". The root value has the path `""`.
   * Keys that are empty or contain `.`, `[`, `]`, `"` or whitespace are written
   * as quoted brackets, e.g. `headers["content.type"]`.
   */
  readonly path: string;
  readonly severity: ReportedSeverity;
}

interface TypeTransition {
  /** The old types, e.g. `"string"` or `"string | null"`. */
  readonly from: string;
  /** The new types, e.g. `"number"` or `"object | null"`. */
  readonly to: string;
}

export interface AddedChange extends BaseChange<"added"> {
  /** The types of the added property. */
  readonly to: string;
}

export interface RemovedChange extends BaseChange<"removed"> {
  /** The types the removed property had. */
  readonly from: string;
}

export interface TypeChangedChange extends BaseChange<"type-changed">, TypeTransition {}

export interface TypeWidenedChange extends BaseChange<"type-widened">, TypeTransition {}

export interface TypeNarrowedChange extends BaseChange<"type-narrowed">, TypeTransition {}

export type RequiredToOptionalChange = BaseChange<"required-to-optional">;

export type OptionalToRequiredChange = BaseChange<"optional-to-required">;

export type ArrayItemsUnknownChange = BaseChange<"array-items-unknown">;

/**
 * A single contract change. Discriminate on `type`.
 */
export type Change =
  | AddedChange
  | RemovedChange
  | TypeChangedChange
  | TypeWidenedChange
  | TypeNarrowedChange
  | RequiredToOptionalChange
  | OptionalToRequiredChange
  | ArrayItemsUnknownChange;

/**
 * The outcome of a comparison. Changes are grouped by severity and ordered
 * deterministically: depth-first, with object keys in sorted order.
 */
export interface DiffResult {
  readonly hasBreakingChanges: boolean;
  readonly breaking: readonly Change[];
  readonly nonBreaking: readonly Change[];
  readonly warnings: readonly Change[];
}

export interface InferOptions {
  /**
   * Maximum nesting depth of objects and arrays. Deeper input throws a
   * `JsonContractError` with code `MAX_DEPTH_EXCEEDED`. Defaults to 100.
   */
  readonly maxDepth?: number;
}

export interface CompareOptions {
  /**
   * Overrides the default severity of individual change types.
   * Change types that are not listed keep their default.
   */
  readonly severity?: Readonly<Partial<Record<ChangeType, Severity>>>;
}

export interface DiffOptions extends InferOptions, CompareOptions {}
