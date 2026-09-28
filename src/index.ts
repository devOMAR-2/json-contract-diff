export { diffJson } from "./diff.js";
export { inferContract } from "./infer.js";
export { compareContracts, DEFAULT_SEVERITY } from "./compare.js";
export { formatDiff, formatChange } from "./format.js";
export { JsonContractError } from "./errors.js";
export type { JsonContractErrorCode } from "./errors.js";
export type {
  AddedChange,
  ArrayItemsUnknownChange,
  Change,
  ChangeType,
  CompareOptions,
  Contract,
  DiffOptions,
  DiffResult,
  InferOptions,
  JsonType,
  OptionalToRequiredChange,
  PropertyContract,
  RemovedChange,
  ReportedSeverity,
  RequiredToOptionalChange,
  Severity,
  TypeChangedChange,
  TypeNarrowedChange,
  TypeWidenedChange,
} from "./types.js";
