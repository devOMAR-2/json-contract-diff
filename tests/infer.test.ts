import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { inferContract, JsonContractError } from "../src/index.js";
import type { Contract } from "../src/index.js";

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

function nestArrays(levels: number): unknown {
  let value: unknown = 1;
  for (let level = 0; level < levels; level++) {
    value = [value];
  }
  return value;
}

describe("inferContract: primitives", () => {
  it.each([
    ["a string", "hello", "string"],
    ["an empty string", "", "string"],
    ["an integer", 42, "number"],
    ["a float", -3.5, "number"],
    ["zero", 0, "number"],
    ["true", true, "boolean"],
    ["false", false, "boolean"],
    ["null", null, "null"],
  ] as const)("infers %s", (_label, value, type) => {
    expect(inferContract(value)).toEqual({ types: [type] });
  });
});

describe("inferContract: objects", () => {
  it("records every property as required with its contract", () => {
    expect(inferContract({ name: "Ada", age: 36, admin: false, manager: null })).toEqual({
      types: ["object"],
      properties: {
        admin: { required: true, contract: { types: ["boolean"] } },
        age: { required: true, contract: { types: ["number"] } },
        manager: { required: true, contract: { types: ["null"] } },
        name: { required: true, contract: { types: ["string"] } },
      },
    });
  });

  it("infers an empty object with an empty property record", () => {
    expect(inferContract({})).toEqual({ types: ["object"], properties: {} });
  });

  it("infers nested objects", () => {
    expect(inferContract({ user: { profile: { age: 1 } } })).toEqual({
      types: ["object"],
      properties: {
        user: {
          required: true,
          contract: {
            types: ["object"],
            properties: {
              profile: {
                required: true,
                contract: {
                  types: ["object"],
                  properties: { age: { required: true, contract: { types: ["number"] } } },
                },
              },
            },
          },
        },
      },
    });
  });

  it("sorts properties regardless of input key order", () => {
    const contract = inferContract({ zeta: 1, alpha: 2, Mid: 3, beta: 4 });
    expect(Object.keys(contract.properties ?? {})).toEqual(["Mid", "alpha", "beta", "zeta"]);
    expect(inferContract({ beta: 4, Mid: 3, alpha: 2, zeta: 1 })).toEqual(contract);
  });

  it("accepts objects with a null prototype", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.id = 1;
    expect(inferContract(value)).toEqual({
      types: ["object"],
      properties: { id: { required: true, contract: { types: ["number"] } } },
    });
  });

  it("accepts plain objects created in another realm", () => {
    const value: unknown = runInNewContext(`JSON.parse('{"id": 1, "tags": [{"name": "a"}]}')`);
    expect(Object.getPrototypeOf(value)).not.toBe(Object.prototype);
    expect(inferContract(value)).toEqual(inferContract({ id: 1, tags: [{ name: "a" }] }));
  });

  it("rejects dates and class instances created in another realm", () => {
    expect(captureError(() => inferContract(runInNewContext("new Date()"))).message).toContain(
      "Date instance is not a plain JSON object",
    );
    expect(
      captureError(() => inferContract(runInNewContext("new (class Point {})()"))).message,
    ).toContain("Point instance is not a plain JSON object");
  });

  it("rejects objects whose prototype only imitates Object.prototype", () => {
    const parent = Object.create(null) as { constructor?: unknown };
    parent.constructor = function Object() {
      return undefined;
    };
    expect(captureError(() => inferContract(Object.create(parent) as object)).code).toBe(
      "INVALID_JSON_VALUE",
    );
    expect(captureError(() => inferContract(Object.setPrototypeOf({}, () => 1))).code).toBe(
      "INVALID_JSON_VALUE",
    );
  });

  it('stores a "__proto__" own key from JSON.parse as a regular property', () => {
    const value: unknown = JSON.parse('{"__proto__": {"polluted": true}, "id": 1}');
    const contract = inferContract(value);

    expect(Object.keys(contract.properties ?? {})).toEqual(["__proto__", "id"]);
    expect(Object.getPrototypeOf(contract.properties)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(contract.properties, "__proto__")?.value).toEqual({
      required: true,
      contract: {
        types: ["object"],
        properties: { polluted: { required: true, contract: { types: ["boolean"] } } },
      },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not treat a shared (non-circular) reference as circular", () => {
    const shared = { id: 1 };
    const contract = inferContract({ a: shared, b: shared, list: [shared, shared] });
    expect(contract.properties?.a).toEqual(contract.properties?.b);
    expect(contract.properties?.list?.contract.items).toEqual({
      types: ["object"],
      properties: { id: { required: true, contract: { types: ["number"] } } },
    });
  });
});

describe("inferContract: arrays", () => {
  it("infers an array of primitives", () => {
    expect(inferContract(["a", "b", "c"])).toEqual({
      types: ["array"],
      items: { types: ["string"] },
    });
  });

  it("infers an empty array without items", () => {
    expect(inferContract([])).toEqual({ types: ["array"] });
  });

  it("merges mixed primitive items into a sorted union", () => {
    expect(inferContract([null, true, 1, "x"])).toEqual({
      types: ["array"],
      items: { types: ["string", "number", "boolean", "null"] },
    });
  });

  it("merges object items and marks properties missing from some items as optional", () => {
    expect(inferContract([{ id: 1, name: "a" }, { id: 2 }, { id: 3, email: "c@d.e" }])).toEqual({
      types: ["array"],
      items: {
        types: ["object"],
        properties: {
          email: { required: false, contract: { types: ["string"] } },
          id: { required: true, contract: { types: ["number"] } },
          name: { required: false, contract: { types: ["string"] } },
        },
      },
    });
  });

  it("infers a nullable property from array items", () => {
    expect(inferContract([{ name: "a" }, { name: null }])).toEqual({
      types: ["array"],
      items: {
        types: ["object"],
        properties: { name: { required: true, contract: { types: ["string", "null"] } } },
      },
    });
  });

  it("keeps a property that is only sometimes present and sometimes null both optional and nullable", () => {
    expect(inferContract([{ name: "a" }, {}, { name: null }]).items?.properties).toEqual({
      name: { required: false, contract: { types: ["string", "null"] } },
    });
  });

  it("computes required relative to object items when mixed with null", () => {
    expect(inferContract([{ id: 1 }, null, { id: 2 }])).toEqual({
      types: ["array"],
      items: {
        types: ["object", "null"],
        properties: { id: { required: true, contract: { types: ["number"] } } },
      },
    });
    expect(inferContract([null, { id: 1 }]).items).toEqual({
      types: ["object", "null"],
      properties: { id: { required: true, contract: { types: ["number"] } } },
    });
  });

  it("merges objects and arrays in one array into a contract with both properties and items", () => {
    expect(inferContract([{ id: 1 }, [true], "x"])).toEqual({
      types: ["array"],
      items: {
        types: ["object", "array", "string"],
        properties: { id: { required: true, contract: { types: ["number"] } } },
        items: { types: ["boolean"] },
      },
    });
  });

  it("merges nested arrays including empty ones", () => {
    expect(inferContract([[], [1], [], ["x"]])).toEqual({
      types: ["array"],
      items: { types: ["array"], items: { types: ["string", "number"] } },
    });
    expect(inferContract([[], []])).toEqual({ types: ["array"], items: { types: ["array"] } });
  });

  it("merges nested object properties across items recursively", () => {
    const contract = inferContract([
      { user: { profile: { age: 1, bio: "x" } } },
      { user: { profile: { age: 2 } } },
    ]);
    expect(contract.items?.properties?.user?.contract.properties?.profile?.contract).toEqual({
      types: ["object"],
      properties: {
        age: { required: true, contract: { types: ["number"] } },
        bio: { required: false, contract: { types: ["string"] } },
      },
    });
  });

  it("infers a matrix", () => {
    expect(
      inferContract([
        [1, 2],
        [3, 4],
      ]),
    ).toEqual({ types: ["array"], items: { types: ["array"], items: { types: ["number"] } } });
  });
});

describe("inferContract: output shape", () => {
  it("always sorts types in the fixed order object, array, string, number, boolean, null", () => {
    const contract = inferContract([null, false, 0, "", [], {}]);
    expect(contract.items?.types).toEqual([
      "object",
      "array",
      "string",
      "number",
      "boolean",
      "null",
    ]);
  });

  it("produces a plain, JSON-serializable contract that survives a round trip", () => {
    const contract = inferContract({
      users: [
        { id: 1, tags: ["a"], manager: null },
        { id: 2, tags: [] },
      ],
      meta: {},
    });
    const roundTripped = JSON.parse(JSON.stringify(contract)) as Contract;
    expect(roundTripped).toEqual(contract);
    expect(roundTripped).toStrictEqual(contract);
  });

  it("does not emit undefined properties or items keys", () => {
    const contract = inferContract(["x"]);
    expect(Object.keys(contract)).toEqual(["types", "items"]);
    expect(Object.keys(contract.items ?? {})).toEqual(["types"]);
    expect(Object.keys(inferContract({}))).toEqual(["types", "properties"]);
  });

  it("gives equal contracts for values with the same shape and different values", () => {
    expect(inferContract({ id: 1, name: "a", tags: ["x"] })).toEqual(
      inferContract({ tags: ["y", "z"], name: "b", id: 99 }),
    );
  });
});

describe("inferContract: invalid values", () => {
  class Point {
    x = 1;
  }

  it.each([
    ["undefined", undefined, "undefined is not a JSON value"],
    ["a function", () => 1, "function is not a JSON value"],
    ["a symbol", Symbol("s"), "symbol is not a JSON value"],
    ["a bigint", 10n, "bigint is not a JSON value"],
    ["NaN", Number.NaN, "NaN is not a valid JSON number"],
    ["Infinity", Number.POSITIVE_INFINITY, "Infinity is not a valid JSON number"],
    ["-Infinity", Number.NEGATIVE_INFINITY, "-Infinity is not a valid JSON number"],
    ["a Date", new Date(0), "Date instance is not a plain JSON object"],
    ["a Map", new Map(), "Map instance is not a plain JSON object"],
    ["a Set", new Set(), "Set instance is not a plain JSON object"],
    ["a class instance", new Point(), "Point instance is not a plain JSON object"],
    ["a boxed string", new String("x"), "String instance is not a plain JSON object"],
  ])("rejects %s at the root", (_label, value, reason) => {
    const error = captureError(() => inferContract(value));
    expect(error).toBeInstanceOf(JsonContractError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("JsonContractError");
    expect(error.code).toBe("INVALID_JSON_VALUE");
    expect(error.path).toBe("");
    expect(error.message).toBe(`The value is not JSON-compatible at the root: ${reason}.`);
  });

  it("reports the path of a nested invalid value", () => {
    const error = captureError(() =>
      inferContract({ users: [{ createdAt: "2024-01-01" }, { createdAt: new Date(0) }] }),
    );
    expect(error.code).toBe("INVALID_JSON_VALUE");
    expect(error.path).toBe("users[1].createdAt");
    expect(error.message).toBe(
      'The value is not JSON-compatible at "users[1].createdAt": Date instance is not a plain JSON object.',
    );
  });

  it("rejects an undefined property value", () => {
    const error = captureError(() => inferContract({ a: { b: undefined } }));
    expect(error.code).toBe("INVALID_JSON_VALUE");
    expect(error.path).toBe("a.b");
  });

  it("quotes unusual keys in error paths", () => {
    const error = captureError(() => inferContract({ "content.type": [1, Number.NaN] }));
    expect(error.path).toBe('["content.type"][1]');
  });

  it("rejects sparse arrays at the position of the first hole", () => {
    const sparse: unknown[] = ["a"];
    sparse.length = 3;
    const error = captureError(() => inferContract({ list: sparse }));
    expect(error.code).toBe("INVALID_JSON_VALUE");
    expect(error.path).toBe("list[1]");
    expect(error.message).toContain("sparse array holes are not JSON values");
  });

  it("describes objects whose prototype has no constructor", () => {
    const value = Object.create(Object.create(null) as object) as object;
    const error = captureError(() => inferContract(value));
    expect(error.message).toContain("object with a custom prototype is not a plain JSON object");
  });

  it("describes objects inheriting from a plain object as objects with a custom prototype", () => {
    const value = Object.create({}) as object;
    const error = captureError(() => inferContract(value));
    expect(error.message).toContain("object with a custom prototype is not a plain JSON object");
  });

  it("returns frozen shared leaf contracts", () => {
    const contract = inferContract("text");
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.types)).toBe(true);
  });

  it("describes instances of anonymous classes as objects with a custom prototype", () => {
    const Anonymous = (() =>
      class {
        value = 1;
      })();
    const error = captureError(() => inferContract(new Anonymous()));
    expect(error.message).toContain("object with a custom prototype is not a plain JSON object");
  });

  it("detects a circular object reference", () => {
    const value: Record<string, unknown> = { name: "loop" };
    value.self = value;
    const error = captureError(() => inferContract({ root: value }));
    expect(error.code).toBe("CIRCULAR_REFERENCE");
    expect(error.path).toBe("root.self");
    expect(error.message).toBe('The value contains a circular reference at "root.self".');
  });

  it("detects a circular array reference", () => {
    const value: unknown[] = [1];
    value.push(value);
    const error = captureError(() => inferContract(value));
    expect(error.code).toBe("CIRCULAR_REFERENCE");
    expect(error.path).toBe("[1]");
  });
});

describe("inferContract: maxDepth", () => {
  it("accepts nesting up to the default maximum depth of 100", () => {
    expect(() => inferContract(nestArrays(100))).not.toThrow();
  });

  it("rejects nesting beyond the default maximum depth", () => {
    const error = captureError(() => inferContract(nestArrays(101)));
    expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
    expect(error.path).toBe("[0]".repeat(100));
    expect(error.message).toContain("nested deeper than the maximum depth of 100");
  });

  it("fails cleanly instead of overflowing the stack on very deep input", () => {
    expect(captureError(() => inferContract(nestArrays(20_000))).code).toBe("MAX_DEPTH_EXCEEDED");
  });

  it("counts objects and arrays, including empty ones, but not primitives", () => {
    expect(() => inferContract({ a: 1 }, { maxDepth: 1 })).not.toThrow();
    expect(() => inferContract("x", { maxDepth: 1 })).not.toThrow();

    const error = captureError(() => inferContract({ a: {} }, { maxDepth: 1 }));
    expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
    expect(error.path).toBe("a");
    expect(error.message).toBe('The value is nested deeper than the maximum depth of 1 at "a".');
  });

  it("reports the first container that is too deep", () => {
    const error = captureError(() => inferContract({ a: { b: [] } }, { maxDepth: 2 }));
    expect(error.path).toBe("a.b");
    expect(() => inferContract({ a: { b: [] } }, { maxDepth: 3 })).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects maxDepth %s as an invalid option",
    (maxDepth) => {
      const error = captureError(() => inferContract({}, { maxDepth }));
      expect(error.code).toBe("INVALID_OPTIONS");
      expect(error.path).toBeUndefined();
      expect(error.message).toBe(
        `Invalid option "maxDepth": expected a positive integer, received ${String(maxDepth)}.`,
      );
    },
  );

  it("rejects a non-number maxDepth passed from untyped code", () => {
    const options = { maxDepth: "5" } as unknown as { maxDepth: number };
    expect(captureError(() => inferContract({}, options)).code).toBe("INVALID_OPTIONS");
  });
});
