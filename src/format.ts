import { displayPath } from "./path.js";
import type { Change, DiffResult } from "./types.js";

const SECTIONS = [
  { title: "Breaking changes", key: "breaking", marker: "✖" },
  { title: "Non-breaking changes", key: "nonBreaking", marker: "+" },
  { title: "Warnings", key: "warnings", marker: "!" },
] as const;

/**
 * Describes a single change in one line, e.g. `id: type changed from number to string`.
 */
export function formatChange(change: Change): string {
  return `${displayPath(change.path)}: ${describe(change)}`;
}

/**
 * Renders a diff result as a plain-text report (no ANSI colors), suitable for
 * terminals and CI logs. The output always ends with a newline.
 */
export function formatDiff(result: DiffResult): string {
  const lines = ["JSON Contract Diff", ""];

  const total = result.breaking.length + result.nonBreaking.length + result.warnings.length;
  if (total === 0) {
    lines.push("No contract changes detected.");
    return `${lines.join("\n")}\n`;
  }

  for (const { title, key, marker } of SECTIONS) {
    const changes = result[key];
    if (changes.length === 0) {
      continue;
    }
    const heading = `${title} (${changes.length})`;
    lines.push(heading, "-".repeat(heading.length));
    for (const change of changes) {
      lines.push(`${marker} ${formatChange(change)}`);
    }
    lines.push("");
  }

  const summary = [
    plural(result.breaking.length, "breaking change"),
    plural(result.nonBreaking.length, "non-breaking change"),
    plural(result.warnings.length, "warning"),
  ];
  lines.push(`Summary: ${summary.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

function describe(change: Change): string {
  switch (change.type) {
    case "added":
      return `property added (${change.to})`;
    case "removed":
      return `property removed (was ${change.from})`;
    case "type-changed":
      return `type changed from ${change.from} to ${change.to}`;
    case "type-widened":
      return `type widened from ${change.from} to ${change.to}`;
    case "type-narrowed":
      return `type narrowed from ${change.from} to ${change.to}`;
    case "required-to-optional":
      return "changed from required to optional";
    case "optional-to-required":
      return "changed from optional to required";
    case "array-items-unknown":
      return "item contract cannot be verified (new array is empty)";
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
