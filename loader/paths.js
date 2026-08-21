// A port of the parts of `src/path_utils.rs` a loader can reach.
//
// The virtual-root branches are not ported: a bundler hands a loader the real
// `resourcePath`, so the `[project]/…` and already-relative forms the plugin
// has to cope with cannot arrive here. What remains -- root resolution and the
// project/dependency test -- has to behave exactly as the plugin does, so one
// config produces the same attribute through either path.

"use strict";

/** @param {string} path */
function normalizeSeparators(path) {
  return path.includes("\\") ? path.replaceAll("\\", "/") : path;
}

/**
 * Split a `/`-normalized path into its root prefix -- kept verbatim, trailing
 * separator included -- and the segments after it. Windows roots are detected
 * explicitly so a `C:` never reads as an ordinary segment.
 *
 * @param {string} path
 * @returns {[string, string]}
 */
function splitRoot(path) {
  if (path.startsWith("//")) return [path.slice(0, 2), path.slice(2)];
  if (path.startsWith("/")) return [path.slice(0, 1), path.slice(1)];
  if (/^[A-Za-z]:\//.test(path)) return [path.slice(0, 3), path.slice(3)];
  return ["", path];
}

/** @param {string} path */
function isAbsolute(path) {
  return splitRoot(path)[0] !== "";
}

/**
 * Collapse `.` and `..` segments textually, so a configured root and a resolved
 * path are compared in one shape.
 *
 * @param {string} path
 */
function normalizeDots(path) {
  const [root, rest] = splitRoot(path);
  /** @type {string[]} */
  const segments = [];

  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }
    if (segments.length > 0 && segments[segments.length - 1] !== "..") {
      segments.pop();
    } else if (root === "") {
      // Nothing to pop and no root above us, so the `..` has to survive for a
      // relative `root-dir` like `../..` to mean anything.
      segments.push("..");
    }
  }

  return root + segments.join("/");
}

/**
 * Whether the working directory already *is* the directory a relative
 * `root-dir` names -- `/repo/apps/web` for `apps/web`.
 *
 * @param {string} cwd
 * @param {string} rootDir
 */
function cwdIsRootDir(cwd, rootDir) {
  rootDir = rootDir.replace(/\/+$/, "");
  cwd = cwd.replace(/\/+$/, "");
  if (rootDir === "" || !cwd.endsWith(rootDir)) return false;

  // Only a separator marks a directory boundary, so `web` does not match a
  // working directory that merely ends in `myweb`.
  return cwd.slice(0, cwd.length - rootDir.length).endsWith("/");
}

/**
 * Resolve the configured `root-dir` against the build's working directory.
 * Unset means the working directory itself; a relative value is anchored to it;
 * an absolute one is taken verbatim.
 *
 * @param {string | undefined} rootDir
 * @param {string} cwd
 * @returns {string}
 */
function resolveRootDir(rootDir, cwd) {
  cwd = normalizeDots(normalizeSeparators(cwd));
  if (rootDir === undefined) return cwd;

  rootDir = normalizeSeparators(rootDir);
  if (isAbsolute(rootDir)) return normalizeDots(rootDir);

  rootDir = normalizeDots(rootDir);

  // A relative `root-dir` is usually written for Turbopack, which measures
  // every path from the repo root: `apps/web` names the project inside it. A
  // build run *from* that directory would otherwise look for
  // `apps/web/apps/web` -- a directory no file is under, so every attribute
  // would be dropped. Reading it as "we are already there" is what lets one
  // config serve both.
  if (cwdIsRootDir(cwd, rootDir)) return cwd;

  return normalizeDots(`${cwd.replace(/\/+$/, "")}/${rootDir}`);
}

/** @param {string} path */
function isInsideDependencies(path) {
  return path.split("/").includes("node_modules");
}

/**
 * Make `path` relative to `rootDir`, or return `undefined` when the file is not
 * project source -- outside the root, or inside a dependency.
 *
 * A library's own internals are not project source: clicking a library
 * component should land on the line in *your* code that rendered it, and that
 * call site lives in a project file, which is annotated normally.
 *
 * @param {string} path
 * @param {string} rootDir
 * @returns {string | undefined}
 */
function projectRelativePath(path, rootDir) {
  path = normalizeDots(normalizeSeparators(path));
  rootDir = normalizeSeparators(rootDir).replace(/\/+$/, "");

  if (rootDir !== "") {
    if (!path.startsWith(rootDir)) return undefined;
    const stripped = path.slice(rootDir.length);
    // Only a separator marks a real directory boundary: `/app` must not match
    // `/apps/web/Button.tsx` and eat the `s`.
    if (!stripped.startsWith("/")) return undefined;
    path = stripped.replace(/^\/+/, "");
  }

  return isInsideDependencies(path) ? undefined : path;
}

module.exports = {
  normalizeSeparators,
  normalizeDots,
  isAbsolute,
  resolveRootDir,
  projectRelativePath,
};
