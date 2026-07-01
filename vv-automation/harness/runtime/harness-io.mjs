import fs from "node:fs";
import path from "node:path";

export const REPO_ROOT = findRepoRoot(process.cwd());

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
    } else if (args[key]) {
      args[key] = Array.isArray(args[key]) ? [...args[key], value] : [args[key], value];
      index += 1;
    } else {
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

export function readJson(repoPath) {
  return JSON.parse(fs.readFileSync(resolveRepoPath(repoPath), "utf8"));
}

export function writeJson(repoPath, data) {
  const outPath = resolveRepoPath(repoPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function readYaml(repoPath) {
  return parseYaml(fs.readFileSync(resolveRepoPath(repoPath), "utf8"));
}

export function writeYaml(repoPath, data) {
  const outPath = resolveRepoPath(repoPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${toYaml(data)}\n`, "utf8");
}

export function resolveRepoPath(inputPath) {
  if (!inputPath) return REPO_ROOT;
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(REPO_ROOT, inputPath);
}

export function normalizeRepoPath(inputPath) {
  if (!inputPath) return "";
  const normalized = path.isAbsolute(inputPath) ? path.relative(REPO_ROOT, inputPath) : inputPath;
  return normalized.replaceAll(path.sep, "/");
}

export function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeList(item));
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

export function isEnabled(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

export function ensureDir(repoPath) {
  fs.mkdirSync(resolveRepoPath(repoPath), { recursive: true });
}

export function parseYaml(content) {
  const lines = content
    .split(/\r?\n/)
    .map((raw) => ({ raw, indent: raw.match(/^ */)[0].length, text: stripYamlComment(raw) }))
    .filter((line) => line.text.trim() !== "");

  if (lines.length === 0) return {};
  const [value] = parseBlock(lines, 0, lines[0].indent);
  return value;
}

function stripYamlComment(raw) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle) inDouble = !inDouble;
    if (char === "#" && !inSingle && !inDouble && (index === 0 || /\s/.test(raw[index - 1]))) {
      return raw.slice(0, index).trimEnd();
    }
  }
  return raw;
}

function parseBlock(lines, startIndex, indent) {
  const first = nextLineAtOrAfter(lines, startIndex, indent);
  if (!first) return [{}, startIndex];
  const trimmed = first.line.text.trimStart();
  if (trimmed === "-" || trimmed.startsWith("- ")) {
    return parseArray(lines, first.index, first.line.indent);
  }
  return parseObject(lines, first.index, indent);
}

function parseArray(lines, startIndex, indent) {
  const output = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      index += 1;
      continue;
    }
    const trimmed = line.text.trimStart();
    if (trimmed !== "-" && !trimmed.startsWith("- ")) break;

    const rest = trimmed === "-" ? "" : trimmed.slice(2).trim();
    if (!rest) {
      const [child, nextIndex] = parseBlock(lines, index + 1, nextContentIndent(lines, index + 1, indent + 2));
      output.push(child);
      index = nextIndex;
      continue;
    }

    const keyValue = splitKeyValue(rest);
    if (keyValue) {
      const item = {};
      assignKeyValue(item, keyValue.key, keyValue.value);
      const next = lines[index + 1];
      if (next && next.indent > indent) {
        const [child, nextIndex] = parseObject(lines, index + 1, next.indent);
        output.push(deepMerge(item, child));
        index = nextIndex;
      } else {
        output.push(item);
        index += 1;
      }
    } else {
      output.push(parseScalar(rest));
      index += 1;
    }
  }

  return [output, index];
}

function parseObject(lines, startIndex, indent) {
  const output = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      index += 1;
      continue;
    }
    const trimmed = line.text.trimStart();
    if (trimmed.startsWith("- ")) break;

    const keyValue = splitKeyValue(trimmed);
    if (!keyValue) {
      index += 1;
      continue;
    }

    if (keyValue.value === "") {
      const childIndent = nextContentIndent(lines, index + 1, indent + 2);
      const [child, nextIndex] = parseBlock(lines, index + 1, childIndent);
      output[keyValue.key] = child;
      index = nextIndex;
    } else {
      output[keyValue.key] = parseScalar(keyValue.value);
      index += 1;
    }
  }

  return [output, index];
}

function splitKeyValue(text) {
  const match = text.match(/^([^:]+):(.*)$/);
  if (!match) return null;
  return { key: match[1].trim(), value: match[2].trim() };
}

function assignKeyValue(target, key, value) {
  target[key] = value === "" ? {} : parseScalar(value);
}

function parseScalar(value) {
  if (value === "") return "";
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function nextLineAtOrAfter(lines, startIndex, indent) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index].indent >= indent) return { line: lines[index], index };
  }
  return null;
}

function nextContentIndent(lines, startIndex, fallback) {
  for (let index = startIndex; index < lines.length; index += 1) {
    return lines[index].indent;
  }
  return fallback;
}

function deepMerge(left, right) {
  for (const [key, value] of Object.entries(right)) {
    if (isPlainObject(left[key]) && isPlainObject(value)) {
      left[key] = deepMerge(left[key], value);
    } else {
      left[key] = value;
    }
  }
  return left;
}

export function toYaml(value, indent = 0) {
  const spaces = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.map((item) => {
      if (isPlainObject(item) || Array.isArray(item)) return `${spaces}-\n${toYaml(item, indent + 2)}`;
      return `${spaces}- ${formatScalar(item)}`;
    }).join("\n");
  }
  if (isPlainObject(value)) {
    return Object.entries(value).map(([key, item]) => {
      if (Array.isArray(item)) return item.length === 0 ? `${spaces}${key}: []` : `${spaces}${key}:\n${toYaml(item, indent + 2)}`;
      if (isPlainObject(item)) return Object.keys(item).length === 0 ? `${spaces}${key}: {}` : `${spaces}${key}:\n${toYaml(item, indent + 2)}`;
      return `${spaces}${key}: ${formatScalar(item)}`;
    }).join("\n");
  }
  return `${spaces}${formatScalar(value)}`;
}

function formatScalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  if (!text) return '""';
  if (/[:#{}\[\],&*?|\-<>=!%@`]/.test(text) || /^\s|\s$/.test(text)) return JSON.stringify(text);
  return text;
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findRepoRoot(startDir) {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    current = path.dirname(current);
  }
  return startDir;
}
