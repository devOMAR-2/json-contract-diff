import { describeTypes, hasOwn } from "./contract.js";
import { JsonContractError } from "./errors.js";
import { appendItems, appendKey, ROOT_PATH } from "./path.js";
import type {
  Change,
  ChangeType,
  CompareOptions,
  Contract,
  DiffResult,
  PropertyContract,
  ReportedSeverity,
  Severity,
} from "./types.js";

/**
 * The severity each change type has unless overridden.
 *
 * The defaults take the consumer's point of view: the JSON is produced by a
 * server and read by clients, so anything a client may not handle
 * (a missing property, an unexpected type) is breaking.
 */
export const DEFAULT_SEVERITY: Readonly<Record<ChangeType, Severity>> = Object.freeze({
  added: "non-breaking",
  removed: "breaking",
  "type-changed": "breaking",
  "type-widened": "breaking",
  "type-narrowed": "non-breaking",
  "required-to-optional": "warning",
  "optional-to-required": "non-breaking",
  "array-items-unknown": "warning",
});

/** @internal */
export const SEVERITY_LEVELS: readonly Severity[] = [
  "breaking",
  "non-breaking",
  "warning",
  "ignore",
];

const SEVERITIES: ReadonlySet<string> = new Set(SEVERITY_LEVELS);

// A change before its severity is resolved. Distributes over the union so each member keeps its fields.
type WithoutSeverity<C> = C extends Change ? Omit<C, "severity"> : never;
type ChangeData = WithoutSeverity<Change>;

/**
 * Compares two contracts and classifies every structural difference.
 *
 * @throws {JsonContractError} with code `INVALID_OPTIONS` for unknown change
 *   types or severities in `options.severity`.
 */
export function compareContracts(
  oldContract: Contract,
  newContract: Contract,
  options: CompareOptions = {},
): DiffResult {
  const severities = resolveSeverities((options as CompareOptions | null)?.severity);
  const breaking: Change[] = [];
  const nonBreaking: Change[] = [];
  const warnings: Change[] = [];

  const report = (data: ChangeData): void => {
    const severity = severities[data.type];
    if (severity === "ignore") {
      return;
    }
    const change = { ...data, severity } as Change;
    bucketFor(severity).push(change);
  };

  const bucketFor = (severity: ReportedSeverity): Change[] => {
    switch (severity) {
      case "breaking":
        return breaking;
      case "non-breaking":
        return nonBreaking;
      case "warning":
        return warnings;
    }
  };

  compareNode(oldContract, newContract, ROOT_PATH, report);

  return {
    hasBreakingChanges: breaking.length > 0,
    breaking,
    nonBreaking,
    warnings,
  };
}

function compareNode(
  oldNode: Contract,
  newNode: Contract,
  path: string,
  report: (change: ChangeData) => void,
): void {
  compareTypes(oldNode, newNode, path, report);

  if (oldNode.properties && newNode.properties) {
    compareProperties(oldNode.properties, newNode.properties, path, report);
  }

  if (oldNode.types.includes("array") && newNode.types.includes("array")) {
    const itemsPath = appendItems(path);
    if (oldNode.items && newNode.items) {
      compareNode(oldNode.items, newNode.items, itemsPath, report);
    } else if (oldNode.items) {
      report({ type: "array-items-unknown", path: itemsPath });
    }
  }
}

function compareTypes(
  oldNode: Contract,
  newNode: Contract,
  path: string,
  report: (change: ChangeData) => void,
): void {
  const hasAdded = newNode.types.some((type) => !oldNode.types.includes(type));
  const hasRemoved = oldNode.types.some((type) => !newNode.types.includes(type));
  if (!hasAdded && !hasRemoved) {
    return;
  }

  const from = describeTypes(oldNode);
  const to = describeTypes(newNode);
  if (hasAdded && hasRemoved) {
    report({ type: "type-changed", path, from, to });
  } else if (hasAdded) {
    report({ type: "type-widened", path, from, to });
  } else {
    report({ type: "type-narrowed", path, from, to });
  }
}

function compareProperties(
  oldProperties: Readonly<Record<string, PropertyContract>>,
  newProperties: Readonly<Record<string, PropertyContract>>,
  path: string,
  report: (change: ChangeData) => void,
): void {
  const keys = [...new Set([...Object.keys(oldProperties), ...Object.keys(newProperties)])].sort();

  for (const key of keys) {
    const propertyPath = appendKey(path, key);
    const oldProperty = hasOwn(oldProperties, key) ? oldProperties[key] : undefined;
    const newProperty = hasOwn(newProperties, key) ? newProperties[key] : undefined;

    if (oldProperty && newProperty) {
      if (oldProperty.required && !newProperty.required) {
        report({ type: "required-to-optional", path: propertyPath });
      } else if (!oldProperty.required && newProperty.required) {
        report({ type: "optional-to-required", path: propertyPath });
      }
      compareNode(oldProperty.contract, newProperty.contract, propertyPath, report);
    } else if (oldProperty) {
      report({ type: "removed", path: propertyPath, from: describeTypes(oldProperty.contract) });
    } else if (newProperty) {
      report({ type: "added", path: propertyPath, to: describeTypes(newProperty.contract) });
    }
  }
}

function resolveSeverities(
  // Typed loosely because JavaScript callers may pass anything.
  overrides: unknown,
): Readonly<Record<ChangeType, Severity>> {
  if (overrides === undefined || overrides === null) {
    return DEFAULT_SEVERITY;
  }
  if (typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new JsonContractError(
      "INVALID_OPTIONS",
      'Invalid option "severity": expected an object mapping change types to severities.',
    );
  }

  const resolved: Record<ChangeType, Severity> = { ...DEFAULT_SEVERITY };
  for (const [type, severity] of Object.entries(overrides) as [string, unknown][]) {
    if (!hasOwn(DEFAULT_SEVERITY, type)) {
      throw new JsonContractError(
        "INVALID_OPTIONS",
        `Unknown change type "${type}" in option "severity". Expected one of: ${Object.keys(DEFAULT_SEVERITY).join(", ")}.`,
      );
    }
    if (severity === undefined) {
      continue;
    }
    if (typeof severity !== "string" || !SEVERITIES.has(severity)) {
      throw new JsonContractError(
        "INVALID_OPTIONS",
        `Invalid severity ${typeof severity === "string" ? `"${severity}"` : `of type ${typeof severity}`} for change type "${type}". Expected one of: ${SEVERITY_LEVELS.join(", ")}.`,
      );
    }
    resolved[type as ChangeType] = severity as Severity;
  }
  return resolved;
}
