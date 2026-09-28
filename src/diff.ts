import { compareContracts } from "./compare.js";
import { inferRoot, resolveMaxDepth } from "./infer.js";
import type { DiffOptions, DiffResult } from "./types.js";

/**
 * Compares the structure of two JSON-compatible values and classifies every
 * contract change as breaking, non-breaking or a warning.
 *
 * Only shapes and types are compared, never the values themselves:
 * `{ "age": 26 }` and `{ "age": 50 }` have the same contract.
 *
 * @example
 * const result = diffJson({ id: 1, email: "a@b.c" }, { id: "1" });
 * result.hasBreakingChanges; // true
 * result.breaking;
 * // [
 * //   { type: "removed", path: "email", from: "string", severity: "breaking" },
 * //   { type: "type-changed", path: "id", from: "number", to: "string", severity: "breaking" }
 * // ]
 *
 * @throws {JsonContractError} if either value is not JSON-compatible or an
 *   option is invalid.
 */
export function diffJson(
  oldValue: unknown,
  newValue: unknown,
  options: DiffOptions = {},
): DiffResult {
  const maxDepth = resolveMaxDepth((options as DiffOptions | null)?.maxDepth);
  const oldContract = inferRoot(oldValue, "old value", maxDepth);
  const newContract = inferRoot(newValue, "new value", maxDepth);
  return compareContracts(oldContract, newContract, options);
}
