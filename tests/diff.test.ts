import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SEVERITY, diffJson, JsonContractError } from "../src/index.js";
import type { Change, DiffResult, Severity } from "../src/index.js";

const NO_CHANGES: DiffResult = {
  hasBreakingChanges: false,
  breaking: [],
  nonBreaking: [],
  warnings: [],
};

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

function captureError(fn: () => unknown): JsonContractError {
  try {
    fn();
  } catch (error) {
    if (error instanceof JsonContractError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the function to throw a JsonContractError");
}

/** All reported changes in bucket order: breaking, non-breaking, warnings. */
function allChanges(result: DiffResult): Change[] {
  return [...result.breaking, ...result.nonBreaking, ...result.warnings];
}

describe("diffJson: unchanged contracts", () => {
  it.each([
    ["identical strings", "a", "a"],
    ["identical numbers", 1, 1],
    ["identical booleans", true, true],
    ["null and null", null, null],
    ["different strings", "a", "b"],
    ["different numbers", 1, 2.5],
    ["different booleans", true, false],
    ["empty objects", {}, {}],
    ["empty arrays", [], []],
  ])("reports no changes for %s", (_label, oldValue, newValue) => {
    expect(diffJson(oldValue, newValue)).toEqual(NO_CHANGES);
  });

  it("ignores values and key order in objects", () => {
    expect(
      diffJson(
        { id: 1, name: "Ada", tags: ["a"], address: { city: "London" } },
        { address: { city: "Paris" }, tags: ["b", "c"], name: "Grace", id: 2 },
      ),
    ).toEqual(NO_CHANGES);
  });

  it("ignores array length", () => {
    expect(diffJson([1], [1, 2, 3, 4])).toEqual(NO_CHANGES);
    expect(diffJson([{ a: 1 }, { a: 2 }], [{ a: 3 }])).toEqual(NO_CHANGES);
  });

  it("reports no changes for the identical-contract fixtures", () => {
    expect(diffJson(fixture("users-a.json"), fixture("users-b.json"))).toEqual(NO_CHANGES);
  });

  it("reports no changes when an array that was empty now has items", () => {
    expect(diffJson({ tags: [] }, { tags: ["x"] })).toEqual(NO_CHANGES);
    expect(diffJson([], [{ id: 1 }])).toEqual(NO_CHANGES);
  });
});

describe("diffJson: type changes", () => {
  it("reports number to string as a breaking type change", () => {
    expect(diffJson({ id: 1 }, { id: "1" })).toEqual({
      hasBreakingChanges: true,
      breaking: [
        { type: "type-changed", path: "id", from: "number", to: "string", severity: "breaking" },
      ],
      nonBreaking: [],
      warnings: [],
    });
  });

  it("reports string to null as a breaking type change", () => {
    expect(diffJson({ bio: "x" }, { bio: null }).breaking).toEqual([
      { type: "type-changed", path: "bio", from: "string", to: "null", severity: "breaking" },
    ]);
  });

  it("reports string to string | null as a breaking widening", () => {
    const result = diffJson([{ name: "a" }], [{ name: "a" }, { name: null }]);
    expect(result).toEqual({
      hasBreakingChanges: true,
      breaking: [
        {
          type: "type-widened",
          path: "[].name",
          from: "string",
          to: "string | null",
          severity: "breaking",
        },
      ],
      nonBreaking: [],
      warnings: [],
    });
  });

  it("reports string | null to string as a non-breaking narrowing", () => {
    const result = diffJson([{ name: "a" }, { name: null }], [{ name: "a" }]);
    expect(result).toEqual({
      hasBreakingChanges: false,
      breaking: [],
      nonBreaking: [
        {
          type: "type-narrowed",
          path: "[].name",
          from: "string | null",
          to: "string",
          severity: "non-breaking",
        },
      ],
      warnings: [],
    });
  });

  it("reports a partial overlap of types as a type change", () => {
    expect(diffJson([1, null], ["x", null]).breaking).toEqual([
      {
        type: "type-changed",
        path: "[]",
        from: "number | null",
        to: "string | null",
        severity: "breaking",
      },
    ]);
  });

  it("reports root-level type changes with an empty path", () => {
    expect(diffJson(1, "1").breaking).toEqual([
      { type: "type-changed", path: "", from: "number", to: "string", severity: "breaking" },
    ]);
  });

  it("reports object to array at the root without comparing contents", () => {
    expect(diffJson({ a: 1 }, [1])).toEqual({
      hasBreakingChanges: true,
      breaking: [
        { type: "type-changed", path: "", from: "object", to: "array", severity: "breaking" },
      ],
      nonBreaking: [],
      warnings: [],
    });
  });

  it("reports array to object on a nested property", () => {
    expect(diffJson({ data: [1] }, { data: { items: [1] } }).breaking).toEqual([
      { type: "type-changed", path: "data", from: "array", to: "object", severity: "breaking" },
    ]);
  });

  it("reports object to null and null to object", () => {
    expect(allChanges(diffJson({ user: { id: 1 } }, { user: null }))).toEqual([
      { type: "type-changed", path: "user", from: "object", to: "null", severity: "breaking" },
    ]);
    expect(allChanges(diffJson({ user: null }, { user: { id: 1 } }))).toEqual([
      { type: "type-changed", path: "user", from: "null", to: "object", severity: "breaking" },
    ]);
  });
});

describe("diffJson: properties", () => {
  it("reports an added property as non-breaking", () => {
    expect(diffJson({ id: 1 }, { id: 1, email: "a@b.c" })).toEqual({
      hasBreakingChanges: false,
      breaking: [],
      nonBreaking: [{ type: "added", path: "email", to: "string", severity: "non-breaking" }],
      warnings: [],
    });
  });

  it("reports a removed property as breaking", () => {
    expect(diffJson({ id: 1, email: "a@b.c" }, { id: 1 })).toEqual({
      hasBreakingChanges: true,
      breaking: [{ type: "removed", path: "email", from: "string", severity: "breaking" }],
      nonBreaking: [],
      warnings: [],
    });
  });

  it("describes the full type union of added and removed properties", () => {
    const result = diffJson(
      [
        { id: 1, old: "x" },
        { id: 2, old: null },
      ],
      [
        { id: 1, next: { a: 1 } },
        { id: 2, next: [] },
      ],
    );
    expect(allChanges(result)).toEqual([
      { type: "removed", path: "[].old", from: "string | null", severity: "breaking" },
      { type: "added", path: "[].next", to: "object | array", severity: "non-breaking" },
    ]);
  });

  it("reports a nested property change with a dotted path", () => {
    expect(
      diffJson({ user: { profile: { age: 30 } } }, { user: { profile: { age: "30" } } }).breaking,
    ).toEqual([
      {
        type: "type-changed",
        path: "user.profile.age",
        from: "number",
        to: "string",
        severity: "breaking",
      },
    ]);
  });

  it("reports properties added to and removed from an empty object", () => {
    expect(allChanges(diffJson({}, { a: 1 }))).toEqual([
      { type: "added", path: "a", to: "number", severity: "non-breaking" },
    ]);
    expect(allChanges(diffJson({ a: 1 }, {}))).toEqual([
      { type: "removed", path: "a", from: "number", severity: "breaking" },
    ]);
  });

  it("does not report changes inside an added or removed property", () => {
    expect(allChanges(diffJson({}, { a: { b: { c: [1] } } }))).toEqual([
      { type: "added", path: "a", to: "object", severity: "non-breaking" },
    ]);
  });

  it("reports required-to-optional as a warning", () => {
    expect(diffJson([{ id: 1, name: "a" }], [{ id: 1, name: "a" }, { id: 2 }])).toEqual({
      hasBreakingChanges: false,
      breaking: [],
      nonBreaking: [],
      warnings: [{ type: "required-to-optional", path: "[].name", severity: "warning" }],
    });
  });

  it("reports optional-to-required as non-breaking", () => {
    expect(diffJson([{ id: 1, name: "a" }, { id: 2 }], [{ id: 1, name: "a" }])).toEqual({
      hasBreakingChanges: false,
      breaking: [],
      nonBreaking: [{ type: "optional-to-required", path: "[].name", severity: "non-breaking" }],
      warnings: [],
    });
  });

  it("reports both an optionality change and a type change on the same property", () => {
    const result = diffJson([{ v: 1 }], [{ v: "1" }, {}]);
    expect(result.breaking).toEqual([
      { type: "type-changed", path: "[].v", from: "number", to: "string", severity: "breaking" },
    ]);
    expect(result.warnings).toEqual([
      { type: "required-to-optional", path: "[].v", severity: "warning" },
    ]);
  });

  it("compares properties of objects that became nullable", () => {
    const result = diffJson([{ user: { id: 1 } }], [{ user: { id: "1" } }, { user: null }]);
    expect(result.breaking).toEqual([
      {
        type: "type-widened",
        path: "[].user",
        from: "object",
        to: "object | null",
        severity: "breaking",
      },
      {
        type: "type-changed",
        path: "[].user.id",
        from: "number",
        to: "string",
        severity: "breaking",
      },
    ]);
  });
});

describe("diffJson: arrays", () => {
  it("reports a changed item type in an array of primitives", () => {
    expect(allChanges(diffJson({ tags: ["a"] }, { tags: [1] }))).toEqual([
      { type: "type-changed", path: "tags[]", from: "string", to: "number", severity: "breaking" },
    ]);
  });

  it("reports a widened item type in an array of primitives", () => {
    expect(allChanges(diffJson([1], [1, "x"]))).toEqual([
      {
        type: "type-widened",
        path: "[]",
        from: "number",
        to: "string | number",
        severity: "breaking",
      },
    ]);
  });

  it("reports changes in arrays of objects with [] paths", () => {
    const result = diffJson(
      { users: [{ id: 1, name: "a" }] },
      { users: [{ id: 1, name: 2, email: "x" }] },
    );
    expect(allChanges(result)).toEqual([
      {
        type: "type-changed",
        path: "users[].name",
        from: "string",
        to: "number",
        severity: "breaking",
      },
      { type: "added", path: "users[].email", to: "string", severity: "non-breaking" },
    ]);
  });

  it("reports changes in a matrix as matrix[][]", () => {
    expect(allChanges(diffJson({ matrix: [[1, 2]] }, { matrix: [["1", "2"]] }))).toEqual([
      {
        type: "type-changed",
        path: "matrix[][]",
        from: "number",
        to: "string",
        severity: "breaking",
      },
    ]);
  });

  it("reports changes deep inside nested arrays of objects as a[].b[].c", () => {
    expect(allChanges(diffJson({ a: [{ b: [{ c: 1 }] }] }, { a: [{ b: [{ c: true }] }] }))).toEqual(
      [
        {
          type: "type-changed",
          path: "a[].b[].c",
          from: "number",
          to: "boolean",
          severity: "breaking",
        },
      ],
    );
  });

  it("warns when an array with items is now only observed empty", () => {
    expect(diffJson({ tags: ["a"] }, { tags: [] })).toEqual({
      hasBreakingChanges: false,
      breaking: [],
      nonBreaking: [],
      warnings: [{ type: "array-items-unknown", path: "tags[]", severity: "warning" }],
    });
  });

  it("warns for an empty root array and nested empty arrays", () => {
    expect(allChanges(diffJson([1], []))).toEqual([
      { type: "array-items-unknown", path: "[]", severity: "warning" },
    ]);
    expect(allChanges(diffJson([[1]], [[]]))).toEqual([
      { type: "array-items-unknown", path: "[][]", severity: "warning" },
    ]);
  });

  it("compares items of arrays that became nullable", () => {
    const result = diffJson([{ list: [1] }], [{ list: [] }, { list: null }]);
    expect(allChanges(result)).toEqual([
      {
        type: "type-widened",
        path: "[].list",
        from: "array",
        to: "array | null",
        severity: "breaking",
      },
      { type: "array-items-unknown", path: "[].list[]", severity: "warning" },
    ]);
  });
});

describe("diffJson: heterogeneous arrays", () => {
  it("reports adding a primitive type to a mixed array as widening", () => {
    expect(allChanges(diffJson([1, "a"], [1, "a", true]))).toEqual([
      {
        type: "type-widened",
        path: "[]",
        from: "string | number",
        to: "string | number | boolean",
        severity: "breaking",
      },
    ]);
  });

  it("compares both properties and items when an array mixes objects and arrays", () => {
    const result = diffJson([{ id: 1 }, [1]], [{ id: "1" }, ["x"]]);
    expect(allChanges(result)).toEqual([
      { type: "type-changed", path: "[].id", from: "number", to: "string", severity: "breaking" },
      { type: "type-changed", path: "[][]", from: "number", to: "string", severity: "breaking" },
    ]);
  });

  it("narrows objects | arrays to objects and still compares properties", () => {
    const result = diffJson([{ id: 1 }, [1]], [{ id: 1, extra: true }]);
    expect(allChanges(result)).toEqual([
      {
        type: "type-narrowed",
        path: "[]",
        from: "object | array",
        to: "object",
        severity: "non-breaking",
      },
      { type: "added", path: "[].extra", to: "boolean", severity: "non-breaking" },
    ]);
  });

  it("does not make object properties optional because of null items", () => {
    expect(allChanges(diffJson([{ id: 1 }], [{ id: 1 }, null]))).toEqual([
      {
        type: "type-widened",
        path: "[]",
        from: "object",
        to: "object | null",
        severity: "breaking",
      },
    ]);
  });
});

describe("diffJson: key quoting in paths", () => {
  it.each([
    ["a key with a dot", "a.b", '["a.b"]'],
    ["an empty key", "", '[""]'],
    ["a key with a space", "first name", '["first name"]'],
    ["a key with a tab", "a\tb", '["a\\tb"]'],
    ["a key with brackets", "a[0]", '["a[0]"]'],
    ["a key with a quote", 'say "hi"', '["say \\"hi\\""]'],
  ])("quotes %s", (_label, key, path) => {
    expect(allChanges(diffJson({ [key]: 1 }, { [key]: "1" }))).toEqual([
      { type: "type-changed", path, from: "number", to: "string", severity: "breaking" },
    ]);
  });

  it("does not quote ordinary keys", () => {
    expect(allChanges(diffJson({ "content-type": 1, $ref: 1, 0: 1 }, {}))).toEqual([
      { type: "removed", path: "$ref", from: "number", severity: "breaking" },
      { type: "removed", path: "0", from: "number", severity: "breaking" },
      { type: "removed", path: "content-type", from: "number", severity: "breaking" },
    ]);
  });

  it("combines quoted keys with nested and array paths", () => {
    const result = diffJson(
      { headers: { "content.type": [{ "x y": 1 }] } },
      { headers: { "content.type": [{ "x y": "1" }] } },
    );
    expect(result.breaking.map((change) => change.path)).toEqual([
      'headers["content.type"][]["x y"]',
    ]);
  });
});

describe('diffJson: "__proto__" keys', () => {
  it("handles an own __proto__ key from JSON.parse like any other property", () => {
    const oldValue: unknown = JSON.parse('{"__proto__": {"a": 1}, "b": 1}');
    const newValue: unknown = JSON.parse('{"__proto__": {"a": "1"}}');
    expect(allChanges(diffJson(oldValue, newValue))).toEqual([
      {
        type: "type-changed",
        path: "__proto__.a",
        from: "number",
        to: "string",
        severity: "breaking",
      },
      { type: "removed", path: "b", from: "number", severity: "breaking" },
    ]);
    expect(({} as Record<string, unknown>).a).toBeUndefined();
  });

  it("reports an added and a removed __proto__ key", () => {
    expect(allChanges(diffJson({}, JSON.parse('{"__proto__": 1}')))).toEqual([
      { type: "added", path: "__proto__", to: "number", severity: "non-breaking" },
    ]);
    expect(allChanges(diffJson(JSON.parse('{"__proto__": 1}'), {}))).toEqual([
      { type: "removed", path: "__proto__", from: "number", severity: "breaking" },
    ]);
  });

  it("does not confuse inherited Object.prototype members with properties", () => {
    expect(allChanges(diffJson({ toString: 1 }, { constructor: 1 }))).toEqual([
      { type: "removed", path: "toString", from: "number", severity: "breaking" },
      { type: "added", path: "constructor", to: "number", severity: "non-breaking" },
    ]);
  });
});

describe("diffJson: multiple changes and ordering", () => {
  const oldValue = {
    zeta: 1,
    alpha: { nested: { deep: "x" }, list: [{ b: 1, a: 1 }] },
    removed: true,
    Upper: 1,
  };
  const newValue = {
    added: null,
    alpha: { list: [{ a: "1", c: 1 }], nested: { deep: 1 } },
    zeta: "1",
    Upper: "1",
  };

  it("orders changes depth-first by sorted key within each bucket", () => {
    const result = diffJson(oldValue, newValue);
    expect(result).toEqual({
      hasBreakingChanges: true,
      breaking: [
        { type: "type-changed", path: "Upper", from: "number", to: "string", severity: "breaking" },
        {
          type: "type-changed",
          path: "alpha.list[].a",
          from: "number",
          to: "string",
          severity: "breaking",
        },
        { type: "removed", path: "alpha.list[].b", from: "number", severity: "breaking" },
        {
          type: "type-changed",
          path: "alpha.nested.deep",
          from: "string",
          to: "number",
          severity: "breaking",
        },
        { type: "removed", path: "removed", from: "boolean", severity: "breaking" },
        { type: "type-changed", path: "zeta", from: "number", to: "string", severity: "breaking" },
      ],
      nonBreaking: [
        { type: "added", path: "added", to: "null", severity: "non-breaking" },
        { type: "added", path: "alpha.list[].c", to: "number", severity: "non-breaking" },
      ],
      warnings: [],
    });
  });

  it("produces identical results regardless of input key order", () => {
    const reverse = (value: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(value).reverse());
    const expected = diffJson(oldValue, newValue);
    expect(diffJson(reverse(oldValue), reverse(newValue))).toEqual(expected);
    expect(JSON.stringify(diffJson(reverse(oldValue), reverse(newValue)))).toBe(
      JSON.stringify(expected),
    );
  });

  it("detects every expected change between the API fixtures", () => {
    expect(diffJson(fixture("api-v1.json"), fixture("api-v2.json"))).toEqual({
      hasBreakingChanges: true,
      breaking: [
        {
          type: "type-changed",
          path: "data[].id",
          from: "number",
          to: "string",
          severity: "breaking",
        },
        {
          type: "type-changed",
          path: "data[].orders[].total",
          from: "number",
          to: "object",
          severity: "breaking",
        },
        { type: "removed", path: "data[].phone", from: "string", severity: "breaking" },
        {
          type: "type-widened",
          path: "data[].profile.bio",
          from: "string",
          to: "string | null",
          severity: "breaking",
        },
      ],
      nonBreaking: [
        { type: "added", path: "data[].updatedAt", to: "string", severity: "non-breaking" },
        { type: "added", path: "meta.hasMore", to: "boolean", severity: "non-breaking" },
      ],
      warnings: [{ type: "required-to-optional", path: "data[].nickname", severity: "warning" }],
    });
  });

  it("treats the reverse API migration differently from the forward one", () => {
    const result = diffJson(fixture("api-v2.json"), fixture("api-v1.json"));
    expect(result.hasBreakingChanges).toBe(true);
    expect(result.breaking.map((change) => `${change.type} ${change.path}`)).toEqual([
      "type-changed data[].id",
      "type-changed data[].orders[].total",
      "removed data[].updatedAt",
      "removed meta.hasMore",
    ]);
    expect(result.nonBreaking.map((change) => `${change.type} ${change.path}`)).toEqual([
      "optional-to-required data[].nickname",
      "added data[].phone",
      "type-narrowed data[].profile.bio",
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe("diffJson: severity options", () => {
  it("exposes the documented default severities", () => {
    expect(DEFAULT_SEVERITY).toEqual({
      added: "non-breaking",
      removed: "breaking",
      "type-changed": "breaking",
      "type-widened": "breaking",
      "type-narrowed": "non-breaking",
      "required-to-optional": "warning",
      "optional-to-required": "non-breaking",
      "array-items-unknown": "warning",
    });
    expect(Object.isFrozen(DEFAULT_SEVERITY)).toBe(true);
  });

  it("treats undefined severity entries and null options as unset", () => {
    const expected = diffJson({ a: 1 }, {});
    expect(diffJson({ a: 1 }, {}, { severity: { removed: undefined } as never })).toEqual(expected);
    expect(diffJson({ a: 1 }, {}, { severity: null } as never)).toEqual(expected);
    expect(diffJson({ a: 1 }, {}, null as never)).toEqual(expected);
  });

  it("rejects a severity option that is not an object", () => {
    for (const severity of ["breaking", ["removed"]]) {
      let error: unknown;
      try {
        diffJson({}, {}, { severity } as never);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(JsonContractError);
      expect((error as JsonContractError).code).toBe("INVALID_OPTIONS");
    }
  });

  it("moves a change type to a different bucket", () => {
    const result = diffJson({ a: 1 }, {}, { severity: { removed: "warning" } });
    expect(result).toEqual({
      hasBreakingChanges: false,
      breaking: [],
      nonBreaking: [],
      warnings: [{ type: "removed", path: "a", from: "number", severity: "warning" }],
    });
  });

  it("can make a non-breaking change breaking", () => {
    const result = diffJson({}, { a: 1 }, { severity: { added: "breaking" } });
    expect(result.hasBreakingChanges).toBe(true);
    expect(result.breaking).toEqual([
      { type: "added", path: "a", to: "number", severity: "breaking" },
    ]);
    expect(result.nonBreaking).toEqual([]);
  });

  it("can make a warning non-breaking", () => {
    const result = diffJson(
      { tags: [1] },
      { tags: [] },
      {
        severity: { "array-items-unknown": "non-breaking" },
      },
    );
    expect(result.nonBreaking).toEqual([
      { type: "array-items-unknown", path: "tags[]", severity: "non-breaking" },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("drops ignored change types entirely", () => {
    const result = diffJson(
      { id: 1, gone: 1 },
      { id: "1", fresh: 1 },
      {
        severity: { "type-changed": "ignore", added: "ignore" },
      },
    );
    expect(result).toEqual({
      hasBreakingChanges: true,
      breaking: [{ type: "removed", path: "gone", from: "number", severity: "breaking" }],
      nonBreaking: [],
      warnings: [],
    });
  });

  it("reports no changes when every change type is ignored", () => {
    const severity = Object.fromEntries(
      Object.keys(DEFAULT_SEVERITY).map((type) => [type, "ignore"]),
    ) as Record<keyof typeof DEFAULT_SEVERITY, Severity>;
    expect(diffJson(fixture("api-v1.json"), fixture("api-v2.json"), { severity })).toEqual(
      NO_CHANGES,
    );
  });

  it("keeps defaults for change types that are not overridden", () => {
    const result = diffJson({ a: 1 }, { b: 1 }, { severity: { "type-changed": "warning" } });
    expect(result.breaking).toEqual([
      { type: "removed", path: "a", from: "number", severity: "breaking" },
    ]);
    expect(result.nonBreaking).toEqual([
      { type: "added", path: "b", to: "number", severity: "non-breaking" },
    ]);
  });

  it("rejects an unknown severity level", () => {
    const options = { severity: { removed: "fatal" } } as unknown as Parameters<typeof diffJson>[2];
    const error = captureError(() => diffJson({}, {}, options));
    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.path).toBeUndefined();
    expect(error.message).toBe(
      'Invalid severity "fatal" for change type "removed". Expected one of: breaking, non-breaking, warning, ignore.',
    );
  });

  it("rejects an unknown change type", () => {
    const options = { severity: { renamed: "breaking" } } as unknown as Parameters<
      typeof diffJson
    >[2];
    const error = captureError(() => diffJson({}, {}, options));
    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.message).toBe(
      'Unknown change type "renamed" in option "severity". Expected one of: added, removed, type-changed, type-widened, type-narrowed, required-to-optional, optional-to-required, array-items-unknown.',
    );
  });

  it("rejects inherited member names as change types", () => {
    const options = {
      severity: JSON.parse('{"__proto__": "breaking"}') as unknown,
    } as Parameters<typeof diffJson>[2];
    expect(captureError(() => diffJson({}, {}, options)).code).toBe("INVALID_OPTIONS");
  });
});

describe("diffJson: invalid input", () => {
  it("names the old value in errors about the old value", () => {
    const error = captureError(() => diffJson({ users: [{}, { createdAt: new Date(0) }] }, {}));
    expect(error.code).toBe("INVALID_JSON_VALUE");
    expect(error.path).toBe("users[1].createdAt");
    expect(error.message).toBe(
      'The old value is not JSON-compatible at "users[1].createdAt": Date instance is not a plain JSON object.',
    );
  });

  it("names the new value in errors about the new value", () => {
    const error = captureError(() => diffJson({}, { n: Number.NaN }));
    expect(error.code).toBe("INVALID_JSON_VALUE");
    expect(error.path).toBe("n");
    expect(error.message).toContain("new value");
    expect(error.message).toContain("NaN is not a valid JSON number");
  });

  it("names the value in circular reference errors", () => {
    const circular: Record<string, unknown> = {};
    circular.me = circular;
    const error = captureError(() => diffJson({}, circular));
    expect(error.code).toBe("CIRCULAR_REFERENCE");
    expect(error.path).toBe("me");
    expect(error.message).toBe('The new value contains a circular reference at "me".');
  });

  it("names the value in max depth errors", () => {
    const error = captureError(() => diffJson({ a: { b: {} } }, {}, { maxDepth: 2 }));
    expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
    expect(error.path).toBe("a.b");
    expect(error.message).toBe(
      'The old value is nested deeper than the maximum depth of 2 at "a.b".',
    );
  });

  it("applies maxDepth to both values", () => {
    expect(() => diffJson({ a: {} }, { a: {} }, { maxDepth: 2 })).not.toThrow();
    expect(captureError(() => diffJson({}, [[[]]], { maxDepth: 2 })).path).toBe("[0][0]");
  });

  it("validates maxDepth before inspecting the values", () => {
    const error = captureError(() => diffJson(undefined, undefined, { maxDepth: 0 }));
    expect(error.code).toBe("INVALID_OPTIONS");
  });

  it.each([
    ["undefined", undefined],
    ["a function", () => 1],
    ["a symbol", Symbol("s")],
    ["a bigint", 1n],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a Map", new Map([["a", 1]])],
    ["a Set", new Set([1])],
  ])("rejects %s with a JsonContractError", (_label, value) => {
    const error = captureError(() => diffJson(value, {}));
    expect(error).toBeInstanceOf(JsonContractError);
    expect(error.code).toBe("INVALID_JSON_VALUE");
    expect(error.path).toBe("");
    expect(error.message).toMatch(/^The old value is not JSON-compatible at the root: /u);
  });
});
