import { hasOwn, mergeContracts, toPropertyRecord } from "./contract.js";
import { JsonContractError } from "./errors.js";
import { appendIndex, appendKey, displayPath, ROOT_PATH } from "./path.js";
import type { Contract, InferOptions, PropertyContract } from "./types.js";

export const DEFAULT_MAX_DEPTH = 100;

// Leaf contracts are shared between results, so they are frozen to keep them immutable.
const STRING: Contract = Object.freeze({ types: Object.freeze(["string"] as const) });
const NUMBER: Contract = Object.freeze({ types: Object.freeze(["number"] as const) });
const BOOLEAN: Contract = Object.freeze({ types: Object.freeze(["boolean"] as const) });
const NULL: Contract = Object.freeze({ types: Object.freeze(["null"] as const) });

interface InferContext {
  readonly maxDepth: number;
  readonly subject: string;
  readonly ancestors: Set<object>;
}

/**
 * Infers the structural contract of a JSON-compatible value.
 *
 * Values are ignored; only types and structure are recorded. The elements of
 * an array are merged into a single item contract, so properties missing from
 * some elements become optional and differing types become unions.
 *
 * @throws {JsonContractError} if the value is not JSON-compatible, is circular,
 *   or is nested deeper than `maxDepth`.
 */
export function inferContract(value: unknown, options: InferOptions = {}): Contract {
  return inferRoot(value, "value", resolveMaxDepth((options as InferOptions | null)?.maxDepth));
}

/** @internal */
export function inferRoot(value: unknown, subject: string, maxDepth: number): Contract {
  return infer(value, ROOT_PATH, 0, { maxDepth, subject, ancestors: new Set() });
}

/** @internal */
export function resolveMaxDepth(maxDepth: number | undefined): number {
  if (maxDepth === undefined) {
    return DEFAULT_MAX_DEPTH;
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new JsonContractError(
      "INVALID_OPTIONS",
      `Invalid option "maxDepth": expected a positive integer, received ${String(maxDepth)}.`,
    );
  }
  return maxDepth;
}

function infer(value: unknown, path: string, depth: number, context: InferContext): Contract {
  switch (typeof value) {
    case "string":
      return STRING;
    case "boolean":
      return BOOLEAN;
    case "number":
      if (!Number.isFinite(value)) {
        throw invalid(context, path, `${String(value)} is not a valid JSON number`);
      }
      return NUMBER;
    case "object":
      if (value === null) {
        return NULL;
      }
      return inferContainer(value, path, depth + 1, context);
    default:
      throw invalid(context, path, `${typeof value} is not a JSON value`);
  }
}

function inferContainer(
  value: object,
  path: string,
  depth: number,
  context: InferContext,
): Contract {
  if (depth > context.maxDepth) {
    throw new JsonContractError(
      "MAX_DEPTH_EXCEEDED",
      `The ${context.subject} is nested deeper than the maximum depth of ${context.maxDepth} at ${location(path)}.`,
      path,
    );
  }
  if (context.ancestors.has(value)) {
    throw new JsonContractError(
      "CIRCULAR_REFERENCE",
      `The ${context.subject} contains a circular reference at ${location(path)}.`,
      path,
    );
  }

  context.ancestors.add(value);
  try {
    return Array.isArray(value)
      ? inferArray(value, path, depth, context)
      : inferObject(value, path, depth, context);
  } finally {
    context.ancestors.delete(value);
  }
}

function inferArray(
  value: readonly unknown[],
  path: string,
  depth: number,
  context: InferContext,
): Contract {
  let items: Contract | undefined;
  for (let index = 0; index < value.length; index++) {
    const itemPath = appendIndex(path, index);
    if (!(index in value)) {
      throw invalid(context, itemPath, "sparse array holes are not JSON values");
    }
    const item = infer(value[index], itemPath, depth, context);
    items = items ? mergeContracts(items, item) : item;
  }
  return items ? { types: ["array"], items } : { types: ["array"] };
}

function inferObject(value: object, path: string, depth: number, context: InferContext): Contract {
  if (!isPlainObjectPrototype(Object.getPrototypeOf(value))) {
    throw invalid(context, path, `${describeInstance(value)} is not a plain JSON object`);
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record).map((key): [string, PropertyContract] => [
    key,
    { required: true, contract: infer(record[key], appendKey(path, key), depth, context) },
  ]);
  return { types: ["object"], properties: toPropertyRecord(entries) };
}

/**
 * Accepts `null`, `Object.prototype`, and the `Object.prototype` of another
 * realm (a `vm` context, or a test environment such as Jest's), whose own
 * prototype is `null` and whose own `constructor` is that realm's `Object`.
 */
function isPlainObjectPrototype(prototype: unknown): boolean {
  if (prototype === null || prototype === Object.prototype) {
    return true;
  }
  if (typeof prototype !== "object" || Object.getPrototypeOf(prototype) !== null) {
    return false;
  }
  const constructor: unknown = hasOwn(prototype, "constructor")
    ? (prototype as { constructor: unknown }).constructor
    : undefined;
  return (
    typeof constructor === "function" &&
    constructor.name === "Object" &&
    (constructor as { prototype?: unknown }).prototype === prototype
  );
}

function describeInstance(value: object): string {
  const name = (value.constructor as { name?: unknown } | undefined)?.name;
  return typeof name === "string" && name !== "" && name !== "Object"
    ? `${name} instance`
    : "object with a custom prototype";
}

function location(path: string): string {
  return path === ROOT_PATH ? "the root" : `"${displayPath(path)}"`;
}

function invalid(context: InferContext, path: string, reason: string): JsonContractError {
  return new JsonContractError(
    "INVALID_JSON_VALUE",
    `The ${context.subject} is not JSON-compatible at ${location(path)}: ${reason}.`,
    path,
  );
}
