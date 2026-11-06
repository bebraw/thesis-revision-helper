import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultConfigPath = join(defaultRepoRoot, ".architecture-check.json");

export async function inspectSourceShape({ config, repoRoot }) {
  validateConfig(config);

  const fileViolations = [];
  const directoryViolations = [];

  for (const sourceRoot of config.sourceRoots) {
    await inspectDirectory(join(repoRoot, sourceRoot), repoRoot, config, fileViolations, directoryViolations);
  }

  return {
    directoryViolations: directoryViolations.sort(comparePaths),
    fileViolations: fileViolations.sort(comparePaths),
  };
}

async function inspectDirectory(directory, repoRoot, config, fileViolations, directoryViolations) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  const sourceFiles = entries.filter((entry) => entry.isFile() && isSourceFile(entry.name, config));
  const directoryPath = normalizePath(relative(repoRoot, directory));

  if (sourceFiles.length > config.maxDirectoryFiles && !(directoryPath in config.directoryExceptions)) {
    directoryViolations.push({ files: sourceFiles.length, limit: config.maxDirectoryFiles, path: directoryPath });
  }

  for (const entry of sourceFiles) {
    const absolutePath = join(directory, entry.name);
    const filePath = normalizePath(relative(repoRoot, absolutePath));
    const source = await readFile(absolutePath, "utf8");
    const lines = countLines(source);

    if (lines > config.maxFileLines && !(filePath in config.fileExceptions)) {
      fileViolations.push({ lines, limit: config.maxFileLines, path: filePath });
    }
  }

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    await inspectDirectory(join(directory, entry.name), repoRoot, config, fileViolations, directoryViolations);
  }
}

function isSourceFile(name, config) {
  return config.extensions.includes(extname(name)) && config.excludeSuffixes.every((suffix) => !name.endsWith(suffix));
}

function countLines(source) {
  if (source.length === 0) return 0;
  const lines = source.split("\n").length;
  return source.endsWith("\n") ? lines - 1 : lines;
}

function validateConfig(config) {
  for (const key of ["sourceRoots", "extensions", "excludeSuffixes"]) {
    if (!Array.isArray(config[key]) || config[key].some((value) => typeof value !== "string" || value.length === 0)) {
      throw new Error(`${key} must contain non-empty strings.`);
    }
  }

  for (const key of ["maxFileLines", "maxDirectoryFiles"]) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`${key} must be a positive integer.`);
  }

  validateExceptions("fileExceptions", config.fileExceptions);
  validateExceptions("directoryExceptions", config.directoryExceptions);
}

function validateExceptions(key, exceptions) {
  if (exceptions === null || typeof exceptions !== "object" || Array.isArray(exceptions)) {
    throw new Error(`${key} must be an object of paths and rationales.`);
  }

  for (const [path, rationale] of Object.entries(exceptions)) {
    if (typeof rationale !== "string" || rationale.trim().length === 0) {
      throw new Error(`${key} entry ${path} must include a rationale.`);
    }
  }
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function comparePaths(left, right) {
  return left.path.localeCompare(right.path);
}

async function run() {
  const config = JSON.parse(await readFile(defaultConfigPath, "utf8"));
  const result = await inspectSourceShape({ config, repoRoot: defaultRepoRoot });

  if (result.fileViolations.length === 0 && result.directoryViolations.length === 0) return;

  console.error("Source shape crossed an architecture review threshold.");

  for (const violation of result.fileViolations) {
    console.error(`- ${violation.path}: ${violation.lines} lines (limit ${violation.limit})`);
  }

  for (const violation of result.directoryViolations) {
    console.error(`- ${violation.path}: ${violation.files} direct source files (limit ${violation.limit})`);
  }

  console.error("Run npm run diagnostics:health and use $architecture-review before expanding the affected capability.");
  console.error("If the shape is intentional, record an exact exception with a rationale in .architecture-check.json.");
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await run();
