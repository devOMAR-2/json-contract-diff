import { describe, expect, it } from "vitest";
import { diffJson, formatChange, formatDiff } from "../src/index.js";
import type { Change, DiffResult } from "../src/index.js";

describe("formatChange", () => {
  it.each<[Change, string]>([
    [
      { type: "added", path: "user.email", to: "string", severity: "non-breaking" },
      "user.email: property added (string)",
    ],
    [
      { type: "removed", path: "users[].phone", from: "string | null", severity: "breaking" },
      "users[].phone: property removed (was string | null)",
    ],
    [
      { type: "type-changed", path: "id", from: "number", to: "string", severity: "breaking" },
      "id: type changed from number to string",
    ],
    [
      {
        type: "type-widened",
        path: "bio",
        from: "string",
        to: "string | null",
        severity: "breaking",
      },
      "bio: type widened from string to string | null",
    ],
    [
      {
        type: "type-narrowed",
        path: "bio",
        from: "string | null",
        to: "string",
        severity: "non-breaking",
      },
      "bio: type narrowed from string | null to string",
    ],
    [
      { type: "required-to-optional", path: "users[].name", severity: "warning" },
      "users[].name: changed from required to optional",
    ],
    [
      { type: "optional-to-required", path: "users[].name", severity: "non-breaking" },
      "users[].name: changed from optional to required",
    ],
    [
      { type: "array-items-unknown", path: "tags[]", severity: "warning" },
      "tags[]: item contract cannot be verified (new array is empty)",
    ],
  ])("formats %j", (change, expected) => {
    expect(formatChange(change)).toBe(expected);
  });

  it('shows "(root)" for the root path', () => {
    const [change] = diffJson({ a: 1 }, [1]).breaking;
    expect(change && formatChange(change)).toBe("(root): type changed from object to array");
  });

  it("does not replace a path that only starts with an array marker", () => {
    expect(formatChange({ type: "array-items-unknown", path: "[]", severity: "warning" })).toBe(
      "[]: item contract cannot be verified (new array is empty)",
    );
  });
});

describe("formatDiff", () => {
  it("renders every section with headings, markers and a summary", () => {
    const result = diffJson(
      { id: 1, email: "a@b.c", tags: ["x"], users: [{ name: "a" }] },
      { id: "1", tags: [], users: [{ name: "a" }, {}], createdAt: "2024-01-01" },
    );
    expect(formatDiff(result)).toBe(
      [
        "JSON Contract Diff",
        "",
        "Breaking changes (2)",
        "--------------------",
        "✖ email: property removed (was string)",
        "✖ id: type changed from number to string",
        "",
        "Non-breaking changes (1)",
        "------------------------",
        "+ createdAt: property added (string)",
        "",
        "Warnings (2)",
        "------------",
        "! tags[]: item contract cannot be verified (new array is empty)",
        "! users[].name: changed from required to optional",
        "",
        "Summary: 2 breaking changes, 1 non-breaking change, 2 warnings",
        "",
      ].join("\n"),
    );
  });

  it("renders the no-changes report", () => {
    expect(formatDiff(diffJson({ a: 1 }, { a: 2 }))).toBe(
      "JSON Contract Diff\n\nNo contract changes detected.\n",
    );
  });

  it("omits empty sections and uses singular and plural nouns in the summary", () => {
    const result: DiffResult = {
      hasBreakingChanges: true,
      breaking: [{ type: "removed", path: "a", from: "number", severity: "breaking" }],
      nonBreaking: [],
      warnings: [{ type: "required-to-optional", path: "b", severity: "warning" }],
    };
    expect(formatDiff(result)).toBe(
      "JSON Contract Diff\n" +
        "\n" +
        "Breaking changes (1)\n" +
        "--------------------\n" +
        "✖ a: property removed (was number)\n" +
        "\n" +
        "Warnings (1)\n" +
        "------------\n" +
        "! b: changed from required to optional\n" +
        "\n" +
        "Summary: 1 breaking change, 0 non-breaking changes, 1 warning\n",
    );
  });

  it("renders a root-level change as (root)", () => {
    expect(formatDiff(diffJson("x", 1))).toBe(
      "JSON Contract Diff\n" +
        "\n" +
        "Breaking changes (1)\n" +
        "--------------------\n" +
        "✖ (root): type changed from string to number\n" +
        "\n" +
        "Summary: 1 breaking change, 0 non-breaking changes, 0 warnings\n",
    );
  });

  it("renders a result that only has non-breaking changes", () => {
    expect(formatDiff(diffJson({}, { a: 1, b: [true] }))).toBe(
      "JSON Contract Diff\n" +
        "\n" +
        "Non-breaking changes (2)\n" +
        "------------------------\n" +
        "+ a: property added (number)\n" +
        "+ b: property added (array)\n" +
        "\n" +
        "Summary: 0 breaking changes, 2 non-breaking changes, 0 warnings\n",
    );
  });

  it("uses no ANSI escape codes and always ends with a single newline", () => {
    const outputs = [
      formatDiff(diffJson({}, {})),
      formatDiff(diffJson({ a: 1 }, { b: "x" })),
      formatDiff(diffJson([1], [])),
    ];
    for (const output of outputs) {
      expect(output).not.toContain("\u001b[");
      expect(output.endsWith("\n")).toBe(true);
      expect(output.endsWith("\n\n")).toBe(false);
    }
  });
});
