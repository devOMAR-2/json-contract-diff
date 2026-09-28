import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareContracts, diffJson, inferContract, JsonContractError } from "../src/index.js";
import type { CompareOptions, Contract } from "../src/index.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

const userV1: Contract = {
  types: ["object"],
  properties: {
    id: { required: true, contract: { types: ["number"] } },
    email: { required: true, contract: { types: ["string"] } },
    nickname: { required: false, contract: { types: ["string"] } },
    tags: { required: true, contract: { types: ["array"], items: { types: ["string"] } } },
  },
};

const userV2: Contract = {
  types: ["object"],
  properties: {
    id: { required: true, contract: { types: ["string"] } },
    nickname: { required: true, contract: { types: ["string", "null"] } },
    tags: { required: false, contract: { types: ["array"] } },
    createdAt: { required: true, contract: { types: ["string"] } },
  },
};

describe("compareContracts", () => {
  it("compares hand-written contracts", () => {
    expect(compareContracts(userV1, userV2)).toEqual({
      hasBreakingChanges: true,
      breaking: [
        { type: "removed", path: "email", from: "string", severity: "breaking" },
        { type: "type-changed", path: "id", from: "number", to: "string", severity: "breaking" },
        {
          type: "type-widened",
          path: "nickname",
          from: "string",
          to: "string | null",
          severity: "breaking",
        },
      ],
      nonBreaking: [
        { type: "added", path: "createdAt", to: "string", severity: "non-breaking" },
        { type: "optional-to-required", path: "nickname", severity: "non-breaking" },
      ],
      warnings: [
        { type: "required-to-optional", path: "tags", severity: "warning" },
        { type: "array-items-unknown", path: "tags[]", severity: "warning" },
      ],
    });
  });

  it("reports no changes when comparing a contract with itself", () => {
    expect(compareContracts(userV1, userV1)).toEqual({
      hasBreakingChanges: false,
      breaking: [],
      nonBreaking: [],
      warnings: [],
    });
  });

  it("does not report missing items when the old array had none", () => {
    const oldContract: Contract = { types: ["array"] };
    const newContract: Contract = { types: ["array"], items: { types: ["number"] } };
    expect(compareContracts(oldContract, newContract).warnings).toEqual([]);
    expect(compareContracts(oldContract, oldContract).warnings).toEqual([]);
  });

  it("matches diffJson when given inferred contracts", () => {
    const oldValue = fixture("api-v1.json");
    const newValue = fixture("api-v2.json");
    expect(compareContracts(inferContract(oldValue), inferContract(newValue))).toEqual(
      diffJson(oldValue, newValue),
    );
  });

  it("works on contracts that were stored as JSON and parsed back", () => {
    const stored = JSON.stringify(inferContract(fixture("api-v1.json")));
    const restored = JSON.parse(stored) as Contract;
    expect(compareContracts(restored, inferContract(fixture("api-v2.json")))).toEqual(
      diffJson(fixture("api-v1.json"), fixture("api-v2.json")),
    );
  });

  it("applies severity overrides", () => {
    const result = compareContracts(userV1, userV2, {
      severity: { removed: "ignore", "type-widened": "warning", "array-items-unknown": "breaking" },
    });
    expect(result.breaking.map((change) => `${change.type} ${change.path}`)).toEqual([
      "type-changed id",
      "array-items-unknown tags[]",
    ]);
    expect(result.warnings.map((change) => `${change.type} ${change.path}`)).toEqual([
      "type-widened nickname",
      "required-to-optional tags",
    ]);
  });

  it("reports hasBreakingChanges as false once every breaking change is reclassified", () => {
    const result = compareContracts(userV1, userV2, {
      severity: { removed: "warning", "type-changed": "non-breaking", "type-widened": "ignore" },
    });
    expect(result.hasBreakingChanges).toBe(false);
    expect(result.breaking).toEqual([]);
  });

  it("accepts an empty severity override", () => {
    expect(compareContracts(userV1, userV2, { severity: {} })).toEqual(
      compareContracts(userV1, userV2),
    );
  });

  it("throws INVALID_OPTIONS for invalid severity configuration", () => {
    const badLevel = { severity: { added: "minor" } } as unknown as CompareOptions;
    const badType = { severity: { moved: "warning" } } as unknown as CompareOptions;
    for (const options of [badLevel, badType]) {
      expect(() => compareContracts(userV1, userV2, options)).toThrow(JsonContractError);
      try {
        compareContracts(userV1, userV2, options);
      } catch (error) {
        expect(error).toMatchObject({ code: "INVALID_OPTIONS", path: undefined });
      }
    }
  });
});
