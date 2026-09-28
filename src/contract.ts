import type { Contract, JsonType, PropertyContract } from "./types.js";

const TYPE_ORDER: readonly JsonType[] = ["object", "array", "string", "number", "boolean", "null"];

export function sortTypes(types: Iterable<JsonType>): JsonType[] {
  const set = new Set(types);
  return TYPE_ORDER.filter((type) => set.has(type));
}

export function describeTypes(contract: Contract): string {
  return contract.types.join(" | ");
}

export function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Builds a property record with sorted keys. `Object.fromEntries` defines own
 * properties, so keys such as `__proto__` are stored safely.
 */
export function toPropertyRecord(
  entries: Iterable<readonly [string, PropertyContract]>,
): Record<string, PropertyContract> {
  return Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Combines two contracts observed at the same position (for example two
 * elements of one array) into a contract that accepts both.
 */
export function mergeContracts(a: Contract, b: Contract): Contract {
  const types = sortTypes([...a.types, ...b.types]);
  const properties =
    a.properties && b.properties
      ? mergeProperties(a.properties, b.properties)
      : (a.properties ?? b.properties);
  const items = a.items && b.items ? mergeContracts(a.items, b.items) : (a.items ?? b.items);

  return {
    types,
    ...(properties && { properties }),
    ...(items && { items }),
  };
}

function mergeProperties(
  a: Readonly<Record<string, PropertyContract>>,
  b: Readonly<Record<string, PropertyContract>>,
): Record<string, PropertyContract> {
  const merged: [string, PropertyContract][] = [];

  // A property missing from either side was not seen on every object, so it is optional.
  for (const [key, left] of Object.entries(a)) {
    const right = hasOwn(b, key) ? b[key] : undefined;
    merged.push([
      key,
      right
        ? {
            required: left.required && right.required,
            contract: mergeContracts(left.contract, right.contract),
          }
        : { required: false, contract: left.contract },
    ]);
  }
  for (const [key, right] of Object.entries(b)) {
    if (!hasOwn(a, key)) {
      merged.push([key, { required: false, contract: right.contract }]);
    }
  }

  return toPropertyRecord(merged);
}
