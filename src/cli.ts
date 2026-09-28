import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DEFAULT_SEVERITY, SEVERITY_LEVELS } from "./compare.js";
import { diffJson } from "./diff.js";
import { formatDiff } from "./format.js";
import type { ChangeType, DiffResult, Severity } from "./types.js";

export const EXIT_OK = 0;
export const EXIT_CHANGES = 1;
export const EXIT_ERROR = 2;

const BYTE_ORDER_MARK = 0xfeff;

const FAIL_ON_LEVELS = ["breaking", "warning", "none"] as const;
type FailOn = (typeof FAIL_ON_LEVELS)[number];

const USAGE = `Usage: json-contract-diff <old.json> <new.json> [options]

Compare the structure of two JSON files and report contract changes.
Values are ignored; only shapes and types are compared.

Options:
  --json                      Print the result as JSON instead of a text report
  --fail-on <level>           When to exit with code 1:
                                breaking  on breaking changes (default)
                                warning   on breaking changes or warnings
                                none      never
  --severity <type>=<level>   Override the severity of a change type (repeatable),
                              e.g. --severity required-to-optional=breaking
  --max-depth <n>             Maximum nesting depth of the input (default: 100)
  -h, --help                  Show this help
  -v, --version               Show the version

Exit codes:
  0  no changes at the --fail-on level
  1  changes found at the --fail-on level
  2  invalid input or runtime error
`;

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readFile: (path: string) => Promise<string>;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFile(path, "utf8"),
};

class UsageError extends Error {}

/**
 * Runs the CLI with the given arguments (without the node and script paths)
 * and resolves to the process exit code. Never rejects.
 */
export async function run(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  try {
    return await execute(argv, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`error: ${error.message}\n\nRun "json-contract-diff --help" for usage.\n`);
    } else {
      io.stderr(`error: ${errorMessage(error)}\n`);
    }
    return EXIT_ERROR;
  }
}

async function execute(argv: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArguments(argv);

  if (values.help) {
    io.stdout(USAGE);
    return EXIT_OK;
  }
  if (values.version) {
    io.stdout(`${await readVersion()}\n`);
    return EXIT_OK;
  }

  const [oldPath, newPath, ...extra] = positionals;
  if (oldPath === undefined || newPath === undefined || extra.length > 0) {
    throw new UsageError(`expected exactly two file paths, received ${positionals.length}`);
  }

  const failOn = parseFailOn(values["fail-on"]);
  const severity = parseSeverities(values.severity ?? []);
  const maxDepth =
    values["max-depth"] === undefined ? undefined : parseMaxDepth(values["max-depth"]);

  // Read sequentially so that, when both files are invalid, the error always names the old file.
  const oldValue = await readJsonFile(oldPath, io);
  const newValue = await readJsonFile(newPath, io);

  const result = diffJson(oldValue, newValue, {
    severity,
    ...(maxDepth !== undefined && { maxDepth }),
  });

  io.stdout(values.json ? `${JSON.stringify(result, null, 2)}\n` : formatDiff(result));
  return shouldFail(result, failOn) ? EXIT_CHANGES : EXIT_OK;
}

function parseArguments(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        "fail-on": { type: "string" },
        severity: { type: "string", multiple: true },
        "max-depth": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }
}

function parseFailOn(value: string | undefined): FailOn {
  if (value === undefined) {
    return "breaking";
  }
  if (!(FAIL_ON_LEVELS as readonly string[]).includes(value)) {
    throw new UsageError(
      `invalid --fail-on value "${value}", expected one of: ${FAIL_ON_LEVELS.join(", ")}`,
    );
  }
  return value as FailOn;
}

function parseSeverities(entries: readonly string[]): Partial<Record<ChangeType, Severity>> {
  const severity: Partial<Record<ChangeType, Severity>> = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new UsageError(`invalid --severity value "${entry}", expected <change-type>=<level>`);
    }
    const type = entry.slice(0, separator);
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SEVERITY, type)) {
      throw new UsageError(
        `unknown change type "${type}" in --severity, expected one of: ${Object.keys(DEFAULT_SEVERITY).join(", ")}`,
      );
    }
    const level = entry.slice(separator + 1);
    if (!(SEVERITY_LEVELS as readonly string[]).includes(level)) {
      throw new UsageError(
        `invalid severity "${level}" in --severity, expected one of: ${SEVERITY_LEVELS.join(", ")}`,
      );
    }
    severity[type as ChangeType] = level as Severity;
  }
  return severity;
}

function parseMaxDepth(value: string): number {
  const maxDepth = Number(value);
  if (!/^\d+$/u.test(value) || maxDepth < 1) {
    throw new UsageError(`invalid --max-depth value "${value}", expected a positive integer`);
  }
  return maxDepth;
}

async function readJsonFile(path: string, io: CliIo): Promise<unknown> {
  let text: string;
  try {
    text = await io.readFile(path);
  } catch (error) {
    const reason =
      (error as NodeJS.ErrnoException).code === "ENOENT" ? "file not found" : errorMessage(error);
    throw new Error(`cannot read "${path}": ${reason}`, { cause: error });
  }
  try {
    // Strip a UTF-8 byte order mark, which editors on Windows commonly add.
    return JSON.parse(text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text) as unknown;
  } catch (error) {
    throw new Error(`"${path}" is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
}

function shouldFail(result: DiffResult, failOn: FailOn): boolean {
  switch (failOn) {
    case "breaking":
      return result.hasBreakingChanges;
    case "warning":
      return result.hasBreakingChanges || result.warnings.length > 0;
    case "none":
      return false;
  }
}

async function readVersion(): Promise<string> {
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  return (JSON.parse(packageJson) as { version: string }).version;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
