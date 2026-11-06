import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class ProjectPathError extends Error {}
export class ProjectConflictError extends Error {}
export class ProjectEncodingError extends Error {}
// Separate handles in this process must not race project or draft writes.
const projectQueues = new Map();

function safeRelative(path) {
  if (
    typeof path !== "string" ||
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new ProjectPathError("Invalid project path");
  }
  return path;
}

function fingerprint(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function physicalCandidate(path) {
  let ancestor = resolve(path);
  const missing = [];
  for (;;) {
    try {
      return join(await realpath(ancestor), ...missing);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

function ensureUtf8(path, bytes) {
  if (!/\.tex$/i.test(path)) return;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProjectEncodingError("Source is not valid UTF-8");
  }
}

async function atomicWrite(path, bytes, mode, beforeCommit = async () => {}) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  let created = false;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    created = true;
    await handle.chmod(mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await beforeCommit();
    await rename(temporary, path);
  } finally {
    await handle?.close();
    if (created) {
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}

function draftId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ProjectPathError("Invalid draft ID");
  return id;
}

async function ensureDirectory(path, recursive = false) {
  await mkdir(path, { recursive, mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ProjectPathError("Application data path is not a directory");
}

export class ProjectStore {
  constructor(root, dataDir, rootFile) {
    this.root = root;
    this.dataDir = dataDir;
    this.rootFile = rootFile;
    this.pending = Promise.resolve();
    this.closed = false;
  }

  static async open(projectDirectory, { dataDir, rootFile } = {}) {
    if (typeof projectDirectory !== "string" || typeof dataDir !== "string")
      throw new ProjectPathError("Project and data directory are required");
    const root = await realpath(projectDirectory);
    if (!(await lstat(root)).isDirectory()) throw new ProjectPathError("Project path is not a directory");
    try {
      if ((await lstat(resolve(dataDir))).isSymbolicLink()) throw new ProjectPathError("Application data path cannot be a symbolic link");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const dataPath = await physicalCandidate(dataDir);
    const dataRelative = relative(root, dataPath);
    if (dataRelative === "" || (!dataRelative.startsWith(`..${sep}`) && dataRelative !== ".." && !isAbsolute(dataRelative)))
      throw new ProjectPathError("Application data must be outside the project");
    const store = new ProjectStore(root, dataPath, rootFile);
    if (rootFile !== undefined) await store.read(rootFile);
    return store;
  }

  async pathFor(path) {
    this.ensureOpen();
    const parts = safeRelative(path).split("/");
    let current = this.root;
    for (const part of parts) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new ProjectPathError("Project paths cannot contain symbolic links");
    }
    return current;
  }

  async listFiles() {
    this.ensureOpen();
    const files = [];
    const visit = async (directory, prefix) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await visit(await this.pathFor(path), path);
        else if (entry.isFile()) files.push(path);
      }
    };
    await visit(this.root, "");
    return files.sort();
  }

  async read(path) {
    const fullPath = await this.pathFor(path);
    const handle = await open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new ProjectPathError("Project path is not a file");
      if (stat.nlink !== 1) throw new ProjectPathError("Project files cannot have multiple hard links");
      const bytes = await handle.readFile();
      ensureUtf8(path, bytes);
      return { bytes, version: fingerprint(bytes) };
    } finally {
      await handle.close();
    }
  }

  ensureOpen() {
    if (this.closed) throw new Error("Project is closed");
  }

  enqueue(action) {
    this.ensureOpen();
    const previous = projectQueues.get(this.root) ?? Promise.resolve();
    const result = previous.then(action);
    const settled = result.catch(() => {});
    projectQueues.set(this.root, settled);
    void settled.then(() => {
      if (projectQueues.get(this.root) === settled) projectQueues.delete(this.root);
    });
    this.pending = settled;
    return result;
  }

  async save(path, expectedVersion, newBytes) {
    if (!(newBytes instanceof Uint8Array)) throw new TypeError("Source must be bytes");
    const bytes = Buffer.from(newBytes);
    ensureUtf8(path, bytes);
    return this.enqueue(async () => {
      const initial = await this.read(path);
      if (initial.version !== expectedVersion) throw new ProjectConflictError("Source changed outside the application");
      if (Buffer.from(initial.bytes).equals(bytes)) return initial;
      const fullPath = await this.pathFor(path);
      const mode = (await lstat(fullPath)).mode & 0o777;
      await atomicWrite(fullPath, bytes, mode, async () => {
        try {
          const current = await this.read(path);
          if (current.version !== expectedVersion) throw new ProjectConflictError("Source changed outside the application");
        } catch (error) {
          if (error instanceof ProjectConflictError || error instanceof ProjectPathError) throw error;
          throw new ProjectConflictError("Source changed outside the application");
        }
      });
      return this.read(path);
    });
  }

  async draftDirectory() {
    this.ensureOpen();
    await ensureDirectory(this.dataDir, true);
    const physicalData = await realpath(this.dataDir);
    const physicalRelative = relative(this.root, physicalData);
    if (physicalRelative === "" || (!physicalRelative.startsWith(`..${sep}`) && physicalRelative !== ".." && !isAbsolute(physicalRelative)))
      throw new ProjectPathError("Application data must be outside the project");
    const projectData = join(this.dataDir, fingerprint(Buffer.from(this.root)));
    const drafts = join(projectData, "drafts");
    await ensureDirectory(projectData);
    await ensureDirectory(drafts);
    return drafts;
  }

  async saveDraft(id, value) {
    draftId(id);
    const json = JSON.stringify(value);
    if (typeof json !== "string" || Buffer.byteLength(json) > 1_000_000) throw new Error("Invalid draft");
    return this.enqueue(async () => {
      const directory = await this.draftDirectory();
      const path = join(directory, `${id}.json`);
      try {
        if ((await lstat(path)).isSymbolicLink()) throw new ProjectPathError("Draft cannot be a symbolic link");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await atomicWrite(path, Buffer.from(json), 0o600);
    });
  }

  async readDraft(id) {
    draftId(id);
    const path = join(await this.draftDirectory(), `${id}.json`);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1_000_000) throw new Error("Invalid draft");
      return JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  }

  async listDrafts() {
    const directory = await this.draftDirectory();
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^[A-Za-z0-9_-]{1,128}\.json$/.test(entry.name))
      .map((entry) => entry.name.slice(0, -5))
      .sort();
  }

  async removeDraft(id) {
    draftId(id);
    return this.enqueue(async () => {
      const path = join(await this.draftDirectory(), `${id}.json`);
      if ((await lstat(path)).isSymbolicLink()) throw new ProjectPathError("Draft cannot be a symbolic link");
      await unlink(path);
    });
  }

  async close() {
    await this.pending;
    this.closed = true;
  }
}
