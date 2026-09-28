import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import type { CliIo } from "../src/cli.js";
import { diffJson } from "../src/index.js";
import type { DiffResult } from "../src/index.js";

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const API_V1 = fixturePath("api-v1.json");
const API_V2 = fixturePath("api-v2.json");
const USERS_A = fixturePath("users-a.json");
const USERS_B = fixturePath("users-b.json");
const INVALID = fixturePath("invalid.json");
const MISSING = fixturePath("does-not-exist.json");

interface Captured {
  readonly io: CliIo;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

/** An io that reads real files from disk and captures output. */
function diskIo(): Captured {
  return captureIo((path) => readFile(path, "utf8"));
}

/** An io backed by an in-memory file map. */
function memoryIo(files: Readonly<Record<string, string>>): Captured {
  return captureIo((path) => {
    const content = files[path];
    if (content === undefined) {
      return Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }));
    }
    return Promise.resolve(content);
  });
}

function captureIo(readFileImpl: CliIo["readFile"]): Captured {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (text) => {
        out += text;
      },
      stderr: (text) => {
        err += text;
      },
      readFile: readFileImpl,
    },
    stdout: () => out,
    stderr: () => err,
  };
}

async function readJsonFixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

const API_REPORT = `JSON Contract Diff

Breaking changes (4)
--------------------
✖ data[].id: type changed from number to string
✖ data[].orders[].total: type changed from number to object
✖ data[].phone: property removed (was string)
✖ data[].profile.bio: type widened from string to string | null

Non-breaking changes (2)
------------------------
+ data[].updatedAt: property added (string)
+ meta.hasMore: property added (boolean)

Warnings (1)
------------
! data[].nickname: changed from required to optional

Summary: 4 breaking changes, 2 non-breaking changes, 1 warning
`;

describe("cli: comparing real fixture files", () => {
  it("prints the report and exits 1 when there are breaking changes", async () => {
    const captured = diskIo();
    expect(await run([API_V1, API_V2], captured.io)).toBe(1);
    expect(captured.stdout()).toBe(API_REPORT);
    expect(captured.stderr()).toBe("");
  });

  it("exits 0 when the contracts are identical", async () => {
    const captured = diskIo();
    expect(await run([USERS_A, USERS_B], captured.io)).toBe(0);
    expect(captured.stdout()).toBe("JSON Contract Diff\n\nNo contract changes detected.\n");
    expect(captured.stderr()).toBe("");
  });

  it("prints JSON that matches diffJson with --json", async () => {
    const captured = diskIo();
    expect(await run(["--json", API_V1, API_V2], captured.io)).toBe(1);

    const printed = JSON.parse(captured.stdout()) as DiffResult;
    const expected = diffJson(await readJsonFixture(API_V1), await readJsonFixture(API_V2));
    expect(printed).toEqual(expected);
    expect(captured.stdout()).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it("accepts options after the positional arguments", async () => {
    const captured = diskIo();
    expect(await run([USERS_A, USERS_B, "--json"], captured.io)).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual({
      hasBreakingChanges: false,
      breaking: [],
      nonBreaking: [],
      warnings: [],
    });
  });

  it("exits 2 when a file does not exist", async () => {
    const captured = diskIo();
    expect(await run([MISSING, API_V2], captured.io)).toBe(2);
    expect(captured.stdout()).toBe("");
    expect(captured.stderr()).toBe(`error: cannot read "${MISSING}": file not found\n`);
  });

  it("exits 2 when a file is not valid JSON", async () => {
    const captured = diskIo();
    expect(await run([API_V1, INVALID], captured.io)).toBe(2);
    expect(captured.stdout()).toBe("");
    expect(captured.stderr()).toMatch(/^error: ".*invalid\.json" is not valid JSON: .+\n$/u);
  });

  it("exits 2 with the underlying error when a path cannot be read for another reason", async () => {
    const directory = fileURLToPath(new URL("./fixtures", import.meta.url));
    const captured = diskIo();
    expect(await run([directory, API_V2], captured.io)).toBe(2);
    expect(captured.stderr()).toMatch(/^error: cannot read ".*fixtures": E[A-Z]+/u);
  });
});

describe("cli: exit codes and --fail-on", () => {
  const files = {
    "old.json": JSON.stringify({ id: 1, name: "a", tags: ["x"] }),
    "breaking.json": JSON.stringify({ id: "1", name: "a", tags: ["x"] }),
    "warning.json": JSON.stringify({ id: 1, name: "a", tags: [] }),
    "additive.json": JSON.stringify({ id: 1, name: "a", tags: ["x"], extra: true }),
  };

  it.each([
    [[], "breaking.json", 1],
    [[], "warning.json", 0],
    [[], "additive.json", 0],
    [["--fail-on", "breaking"], "breaking.json", 1],
    [["--fail-on", "breaking"], "warning.json", 0],
    [["--fail-on", "warning"], "breaking.json", 1],
    [["--fail-on", "warning"], "warning.json", 1],
    [["--fail-on", "warning"], "additive.json", 0],
    [["--fail-on=warning"], "warning.json", 1],
    [["--fail-on", "none"], "breaking.json", 0],
    [["--fail-on", "none"], "warning.json", 0],
  ])("with %j comparing to %s exits %i", async (flags, newFile, exitCode) => {
    const captured = memoryIo(files);
    expect(await run([...flags, "old.json", newFile], captured.io)).toBe(exitCode);
    expect(captured.stderr()).toBe("");
    expect(captured.stdout()).toContain("JSON Contract Diff");
  });

  it("still prints the full report when --fail-on none suppresses the failure", async () => {
    const captured = memoryIo(files);
    expect(await run(["--fail-on", "none", "old.json", "breaking.json"], captured.io)).toBe(0);
    expect(captured.stdout()).toContain("✖ id: type changed from number to string");
  });
});

describe("cli: --severity", () => {
  const files = {
    "old.json": JSON.stringify({ id: 1, email: "a@b.c" }),
    "removed.json": JSON.stringify({ id: 1 }),
    "added.json": JSON.stringify({ id: 1, email: "a@b.c", phone: "1" }),
  };

  it("turns a breaking exit into success when the change is downgraded", async () => {
    const withoutOverride = memoryIo(files);
    expect(await run(["old.json", "removed.json"], withoutOverride.io)).toBe(1);

    const captured = memoryIo(files);
    expect(
      await run(["--severity", "removed=warning", "old.json", "removed.json"], captured.io),
    ).toBe(0);
    expect(captured.stdout()).toContain("Warnings (1)");
    expect(captured.stdout()).toContain("! email: property removed (was string)");
  });

  it("combines --severity with --fail-on warning", async () => {
    const captured = memoryIo(files);
    const argv = [
      "--severity",
      "removed=warning",
      "--fail-on",
      "warning",
      "old.json",
      "removed.json",
    ];
    expect(await run(argv, captured.io)).toBe(1);
  });

  it("accepts repeated --severity flags", async () => {
    const captured = memoryIo(files);
    const argv = [
      "--severity=added=breaking",
      "--severity",
      "removed=ignore",
      "--json",
      "old.json",
      "added.json",
    ];
    expect(await run(argv, captured.io)).toBe(1);
    expect(JSON.parse(captured.stdout())).toEqual({
      hasBreakingChanges: true,
      breaking: [{ type: "added", path: "phone", to: "string", severity: "breaking" }],
      nonBreaking: [],
      warnings: [],
    });
  });

  it("can ignore a change type entirely", async () => {
    const captured = memoryIo(files);
    expect(
      await run(["--severity", "removed=ignore", "old.json", "removed.json"], captured.io),
    ).toBe(0);
    expect(captured.stdout()).toBe("JSON Contract Diff\n\nNo contract changes detected.\n");
  });

  it.each([
    ["removed", 'invalid --severity value "removed", expected <change-type>=<level>'],
    ["=breaking", 'invalid --severity value "=breaking", expected <change-type>=<level>'],
    [
      "renamed=breaking",
      'unknown change type "renamed" in --severity, expected one of: added, removed, type-changed, type-widened, type-narrowed, required-to-optional, optional-to-required, array-items-unknown',
    ],
    [
      "__proto__=breaking",
      'unknown change type "__proto__" in --severity, expected one of: added, removed, type-changed, type-widened, type-narrowed, required-to-optional, optional-to-required, array-items-unknown',
    ],
  ])("rejects --severity %s as a usage error", async (value, message) => {
    const captured = memoryIo(files);
    expect(await run(["--severity", value, "old.json", "removed.json"], captured.io)).toBe(2);
    expect(captured.stdout()).toBe("");
    expect(captured.stderr()).toBe(
      `error: ${message}\n\nRun "json-contract-diff --help" for usage.\n`,
    );
  });

  it("rejects an unknown severity level", async () => {
    const captured = memoryIo(files);
    expect(
      await run(["--severity", "removed=fatal", "old.json", "removed.json"], captured.io),
    ).toBe(2);
    expect(captured.stderr()).toBe(
      'error: invalid severity "fatal" in --severity, expected one of: breaking, non-breaking, warning, ignore\n\nRun "json-contract-diff --help" for usage.\n',
    );
  });
});

describe("cli: --max-depth", () => {
  const files = {
    "shallow.json": JSON.stringify({ a: 1 }),
    "deep.json": JSON.stringify({ a: { b: { c: 1 } } }),
  };

  it("applies a custom maximum depth", async () => {
    const captured = memoryIo(files);
    expect(await run(["--max-depth", "2", "shallow.json", "deep.json"], captured.io)).toBe(2);
    expect(captured.stderr()).toBe(
      'error: The new value is nested deeper than the maximum depth of 2 at "a.b".\n',
    );
  });

  it("accepts a depth that is large enough", async () => {
    const captured = memoryIo(files);
    expect(await run(["--max-depth", "3", "shallow.json", "deep.json"], captured.io)).toBe(1);
  });

  it.each(["0", "-1", "1.5", "abc", "", "1e2", " 3"])("rejects --max-depth %j", async (value) => {
    const captured = memoryIo(files);
    expect(await run([`--max-depth=${value}`, "shallow.json", "deep.json"], captured.io)).toBe(2);
    expect(captured.stderr()).toBe(
      `error: invalid --max-depth value "${value}", expected a positive integer\n\nRun "json-contract-diff --help" for usage.\n`,
    );
  });
});

describe("cli: usage errors", () => {
  const files = { "a.json": "{}", "b.json": "{}", "c.json": "{}" };
  const hint = '\n\nRun "json-contract-diff --help" for usage.\n';

  it.each([
    [[], 0],
    [["a.json"], 1],
    [["a.json", "b.json", "c.json"], 3],
  ])("rejects %j as the wrong number of paths", async (argv, count) => {
    const captured = memoryIo(files);
    expect(await run(argv, captured.io)).toBe(2);
    expect(captured.stdout()).toBe("");
    expect(captured.stderr()).toBe(
      `error: expected exactly two file paths, received ${count}${hint}`,
    );
  });

  it("names the old file when both files are missing", async () => {
    const captured = memoryIo({});
    expect(await run(["missing-old.json", "missing-new.json"], captured.io)).toBe(2);
    expect(captured.stderr()).toBe('error: cannot read "missing-old.json": file not found\n');
  });

  it("rejects an unknown flag", async () => {
    const captured = memoryIo(files);
    expect(await run(["--verbose", "a.json", "b.json"], captured.io)).toBe(2);
    expect(captured.stderr()).toMatch(/^error: .*--verbose/u);
    expect(captured.stderr().endsWith(hint)).toBe(true);
  });

  it("rejects an option that is missing its value", async () => {
    const captured = memoryIo(files);
    expect(await run(["a.json", "b.json", "--fail-on"], captured.io)).toBe(2);
    expect(captured.stderr()).toContain("--fail-on");
    expect(captured.stderr().endsWith(hint)).toBe(true);
  });

  it("rejects an invalid --fail-on level", async () => {
    const captured = memoryIo(files);
    expect(await run(["--fail-on", "always", "a.json", "b.json"], captured.io)).toBe(2);
    expect(captured.stderr()).toBe(
      `error: invalid --fail-on value "always", expected one of: breaking, warning, none${hint}`,
    );
  });

  it("validates options before reading any file", async () => {
    let reads = 0;
    const captured = captureIo(() => {
      reads++;
      return Promise.resolve("{}");
    });
    expect(await run(["--fail-on", "sometimes", "a.json", "b.json"], captured.io)).toBe(2);
    expect(reads).toBe(0);
  });
});

describe("cli: input handling", () => {
  it("strips a UTF-8 byte order mark before parsing", async () => {
    const captured = memoryIo({
      "bom.json": '﻿{"id": 1, "name": "a"}',
      "plain.json": '{"id": 2, "name": "b"}',
    });
    expect(await run(["bom.json", "plain.json"], captured.io)).toBe(0);
    expect(captured.stdout()).toBe("JSON Contract Diff\n\nNo contract changes detected.\n");
    expect(captured.stderr()).toBe("");
  });

  it("reports which file is not valid JSON", async () => {
    const captured = memoryIo({ "good.json": "{}", "bad.json": "{ nope" });
    expect(await run(["good.json", "bad.json"], captured.io)).toBe(2);
    expect(captured.stderr()).toMatch(/^error: "bad\.json" is not valid JSON: /u);
  });

  it("reports a missing file from the fake file system", async () => {
    const captured = memoryIo({ "a.json": "{}" });
    expect(await run(["a.json", "missing.json"], captured.io)).toBe(2);
    expect(captured.stderr()).toBe('error: cannot read "missing.json": file not found\n');
  });

  it("reports other read failures with the underlying error", async () => {
    const captured = captureIo(() => Promise.reject(new Error("EACCES: permission denied")));
    expect(await run(["a.json", "b.json"], captured.io)).toBe(2);
    expect(captured.stderr()).toBe('error: cannot read "a.json": EACCES: permission denied\n');
  });

  it("compares JSON scalars and root arrays", async () => {
    const captured = memoryIo({ "a.json": "[1, 2]", "b.json": '"text"' });
    expect(await run(["a.json", "b.json"], captured.io)).toBe(1);
    expect(captured.stdout()).toContain("✖ (root): type changed from array to string");
  });

  it("handles a __proto__ key in the input files", async () => {
    const captured = memoryIo({
      "a.json": '{"__proto__": {"admin": true}}',
      "b.json": '{"__proto__": {"admin": "yes"}}',
    });
    expect(await run(["a.json", "b.json"], captured.io)).toBe(1);
    expect(captured.stdout()).toContain("✖ __proto__.admin: type changed from boolean to string");
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it("never rejects, even when output fails with a non-Error value", async () => {
    const errors: string[] = [];
    const io: CliIo = {
      stdout: () => {
        // Simulates a writer that throws a plain string.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "stdout closed";
      },
      stderr: (text) => {
        errors.push(text);
      },
      readFile: () => Promise.resolve("{}"),
    };
    expect(await run(["a.json", "b.json"], io)).toBe(2);
    expect(errors).toEqual(["error: stdout closed\n"]);
  });
});

describe("cli: --help and --version", () => {
  it.each([["--help"], ["-h"]])("prints usage for %s and exits 0", async (flag) => {
    const captured = memoryIo({});
    expect(await run([flag], captured.io)).toBe(0);
    expect(captured.stdout()).toMatch(
      /^Usage: json-contract-diff <old\.json> <new\.json> \[options\]\n/u,
    );
    for (const option of [
      "--json",
      "--fail-on",
      "--severity",
      "--max-depth",
      "--help",
      "--version",
    ]) {
      expect(captured.stdout()).toContain(option);
    }
    expect(captured.stderr()).toBe("");
  });

  it("prints help even when other arguments are present", async () => {
    const captured = memoryIo({});
    expect(await run(["a.json", "--help"], captured.io)).toBe(0);
    expect(captured.stdout()).toContain("Usage:");
  });

  it.each([["--version"], ["-v"]])("prints the package version for %s", async (flag) => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const captured = memoryIo({});
    expect(await run([flag], captured.io)).toBe(0);
    expect(captured.stdout()).toBe(`${packageJson.version}\n`);
    expect(captured.stderr()).toBe("");
  });
});

describe("cli: default io", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function spyOnStream(stream: NodeJS.WriteStream): () => string {
    let written = "";
    vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
      written += String(chunk);
      return true;
    });
    return () => written;
  }

  it("reads files from disk and writes the report to process.stdout", async () => {
    const stdout = spyOnStream(process.stdout);
    const stderr = spyOnStream(process.stderr);
    expect(await run([API_V1, API_V2])).toBe(1);
    expect(stdout()).toBe(API_REPORT);
    expect(stderr()).toBe("");
  });

  it("writes errors to process.stderr", async () => {
    const stdout = spyOnStream(process.stdout);
    const stderr = spyOnStream(process.stderr);
    expect(await run([MISSING, API_V2])).toBe(2);
    expect(stdout()).toBe("");
    expect(stderr()).toBe(`error: cannot read "${MISSING}": file not found
`);
  });
});
