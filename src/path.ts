// Keys containing these characters (or empty keys) would make a dotted path ambiguous.
const NEEDS_QUOTING = /[.[\]"\s]/u;

export const ROOT_PATH = "";

export function appendKey(path: string, key: string): string {
  if (key === "" || NEEDS_QUOTING.test(key)) {
    return `${path}[${JSON.stringify(key)}]`;
  }
  return path === ROOT_PATH ? key : `${path}.${key}`;
}

export function appendItems(path: string): string {
  return `${path}[]`;
}

export function appendIndex(path: string, index: number): string {
  return `${path}[${index}]`;
}

export function displayPath(path: string): string {
  return path === ROOT_PATH ? "(root)" : path;
}
