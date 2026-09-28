/**
 * Machine-readable reason for a {@link JsonContractError}.
 *
 * - `INVALID_JSON_VALUE`: the input contains something JSON cannot represent
 *   (`undefined`, functions, symbols, bigints, non-finite numbers, sparse arrays,
 *   `Date`, `Map`, `Set`, class instances and other objects with a custom
 *   prototype, ...).
 * - `CIRCULAR_REFERENCE`: the input references itself.
 * - `MAX_DEPTH_EXCEEDED`: the input is nested deeper than `maxDepth`.
 * - `INVALID_OPTIONS`: an option has an unsupported value.
 */
export type JsonContractErrorCode =
  "INVALID_JSON_VALUE" | "CIRCULAR_REFERENCE" | "MAX_DEPTH_EXCEEDED" | "INVALID_OPTIONS";

/**
 * The only error type thrown by this library for invalid input or options.
 */
export class JsonContractError extends Error {
  override readonly name = "JsonContractError";
  readonly code: JsonContractErrorCode;
  /**
   * Where in the input the problem was found, e.g. `users[3].createdAt`.
   * `""` is the root value. Absent for option errors.
   */
  readonly path: string | undefined;

  constructor(code: JsonContractErrorCode, message: string, path?: string) {
    super(message);
    this.code = code;
    this.path = path;
  }
}
