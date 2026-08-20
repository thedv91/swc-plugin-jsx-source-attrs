use std::borrow::Cow;
use swc_core::common::FileName;

fn normalize_separators(path: &str) -> Cow<'_, str> {
    if path.contains('\\') {
        Cow::Owned(path.replace('\\', "/"))
    } else {
        Cow::Borrowed(path)
    }
}

/// Split a `/`-normalized path into its root prefix — kept verbatim, trailing
/// separator included — and the segments after it.
///
/// `std::path` is compiled for `wasm32-unknown-unknown` and therefore applies
/// POSIX rules, which would read the `C:` of a Windows path as an ordinary
/// segment. The host can hand us either flavour, so roots are detected here
/// instead.
fn split_root(path: &str) -> (&str, &str) {
    if let Some(rest) = path.strip_prefix("//") {
        return (&path[..2], rest);
    }
    if let Some(rest) = path.strip_prefix('/') {
        return (&path[..1], rest);
    }

    let bytes = path.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/' {
        return (&path[..3], &path[3..]);
    }

    ("", path)
}

fn is_absolute(path: &str) -> bool {
    !split_root(path).0.is_empty()
}

/// Collapse `.` and `..` segments textually — the plugin runs in a wasm
/// sandbox with no filesystem, so there is nothing to canonicalize against.
fn normalize_dots(path: &str) -> String {
    let (root, rest) = split_root(path);
    let mut segments: Vec<&str> = Vec::new();

    for segment in rest.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.last().is_some_and(|last| *last != "..") {
                    segments.pop();
                } else if root.is_empty() {
                    // Nothing to pop and no root above us, so the `..` has to
                    // survive for a relative `root-dir` like `../..` to mean
                    // anything. Under a root it is simply dropped: there is no
                    // parent of `/`.
                    segments.push("..");
                }
            }
            segment => segments.push(segment),
        }
    }

    format!("{}{}", root, segments.join("/"))
}

/// Whether the working directory already *is* the directory a relative
/// `root-dir` names — `/repo/apps/web` for `apps/web`.
fn cwd_is_root_dir(cwd: &str, root_dir: &str) -> bool {
    let root_dir = root_dir.trim_end_matches('/');
    let Some(prefix) = cwd.trim_end_matches('/').strip_suffix(root_dir) else {
        return false;
    };

    // Only a separator marks a directory boundary, so `web` does not match a
    // working directory that merely ends in `myweb`. It also rules out the
    // empty root-dir, whose suffix match is vacuous.
    prefix.ends_with('/')
}

/// Resolve the configured `root-dir` against the host's working directory.
///
/// Leaving `root-dir` unset means the working directory itself, so a build run
/// from a package directory emits package-relative paths with no configuration
/// at all. A relative `root-dir` is anchored to the working directory, which
/// keeps one config correct on every machine and on CI; an absolute one is
/// taken verbatim.
pub fn resolve_root_dir(root_dir: Option<&str>, cwd: Option<&str>) -> Option<String> {
    let cwd = cwd.map(normalize_separators);

    let Some(root_dir) = root_dir else {
        return cwd.map(|cwd| normalize_dots(&cwd));
    };

    let root_dir = normalize_separators(root_dir);
    if is_absolute(&root_dir) {
        return Some(normalize_dots(&root_dir));
    }

    match cwd {
        Some(cwd) => {
            let cwd = normalize_dots(&cwd);
            // `./apps/web` names the same directory as `apps/web`, so both have
            // to reach the comparison below in the same shape.
            let root_dir = normalize_dots(&root_dir);

            // A relative `root-dir` is usually written for Turbopack, which
            // measures every path from the repo root: `apps/web` names the
            // project inside it. Webpack runs the same build *from* that
            // directory, where joining would look for `apps/web/apps/web` —
            // a directory no file is under, so every attribute is dropped.
            // Reading it as "we are already there" is what lets one config
            // serve both bundlers.
            if cwd_is_root_dir(&cwd, &root_dir) {
                return Some(cwd);
            }

            Some(normalize_dots(&format!(
                "{}/{}",
                cwd.trim_end_matches('/'),
                root_dir
            )))
        }
        // With no working directory a relative root-dir has nothing to anchor
        // to. Keep it as written so it simply fails to match and the path stays
        // absolute, rather than stripping some unrelated prefix.
        None => Some(normalize_dots(&root_dir)),
    }
}

/// The `root-dir` a path that is *already* project-relative can be measured
/// against, or `None` when the configured value has no meaning in that space.
///
/// A bundler need not hand plugins filesystem paths. Turbopack addresses
/// modules as `[project]/…`, and Next.js 16.3 hands over the plain
/// `apps/web/src/App.tsx`; either way what arrives is measured from the project
/// root, not from the disk. The only root that can be stripped from such a path
/// is one expressed the same way — relative, and inside the project. An
/// absolute root names a filesystem location the path never reveals, and a
/// leading `..` climbs above the project root, where no such path can live.
pub fn relative_root_dir(root_dir: Option<&str>) -> Option<String> {
    let root_dir = normalize_separators(root_dir?);
    if is_absolute(&root_dir) {
        return None;
    }

    let root_dir = normalize_dots(&root_dir);
    if root_dir == ".." || root_dir.starts_with("../") {
        return None;
    }

    Some(root_dir)
}

fn is_inside_dependencies(path: &str) -> bool {
    path.split('/').any(|segment| segment == "node_modules")
}

/// Strip `root_dir` from the front of `path`, or `None` when `path` is outside
/// it. An empty root strips nothing and filters nothing.
fn strip_root_prefix<'a>(path: &'a str, root_dir: &str) -> Option<&'a str> {
    let root_dir = root_dir.trim_end_matches('/');
    if root_dir.is_empty() {
        return Some(path);
    }

    // Only a separator marks a real directory boundary: `/app` must not match
    // `/apps/web/Button.tsx` and eat the `s`.
    let stripped = path.strip_prefix(root_dir)?;
    if !stripped.starts_with('/') {
        return None;
    }
    Some(stripped.trim_start_matches('/'))
}

/// Turbopack does not hand plugins filesystem paths. It addresses every module
/// through a virtual root: `[project]/src/App.tsx` for your own source, and
/// `[next]/…`, `[externals]/…` and friends for what the bundler injects.
const TURBOPACK_PROJECT_ROOT: &str = "[project]/";

/// Finish an already-project-relative `path`: narrow it to `root_dir` when one
/// applies, then drop it if what remains is a dependency.
fn narrowed_to_project(path: &str, root_dir: Option<&str>) -> Option<String> {
    let path = match root_dir {
        Some(root_dir) => strip_root_prefix(path, root_dir)?,
        None => path,
    };

    (!is_inside_dependencies(path)).then(|| path.to_string())
}

/// Make `path` relative to `root_dir`, or return `None` when the file is not
/// part of the project — outside the root, or inside a dependency.
///
/// A library's own internals are not project source, and annotating them helps
/// nobody: clicking a library component should land on the line in *your* code
/// that rendered it, and that call site lives in a project file, which is
/// annotated normally.
///
/// Both sides are normalized to `/` before comparing, so a Windows-style
/// `root-dir` still matches the host-supplied filename and the emitted value
/// is identical on every platform.
///
/// `relative_root_dir` is the same `root-dir` in the form a project-relative
/// path can be measured against — see [`relative_root_dir`], which produces it.
pub fn project_relative_path(
    path: &str,
    root_dir: Option<&str>,
    relative_root_dir: Option<&str>,
) -> Option<String> {
    let path = normalize_separators(path);

    // Under Turbopack the path is project-relative once its virtual root is
    // removed, so the resolved absolute `root-dir` cannot apply — only a root
    // stated relative to the project root can narrow it further.
    if let Some(relative) = path.strip_prefix(TURBOPACK_PROJECT_ROOT) {
        return narrowed_to_project(relative, relative_root_dir);
    }

    // Any other virtual root is the bundler's own code, not the project's.
    if path.starts_with('[') {
        return None;
    }

    // A host that hands us a relative path has already measured it from the
    // project root — Next.js 16.3 hands over `apps/web/src/App.tsx` rather than
    // the `[project]/…` form its docs describe. So this is the same space as
    // the branch above, and takes the same root: the absolute one cannot apply
    // here either, and measuring against it would only reject the file.
    if !is_absolute(&path) {
        return narrowed_to_project(&path, relative_root_dir);
    }

    let Some(root_dir) = root_dir else {
        // With no root there is nothing to measure "inside the project"
        // against, so only the dependency check can apply.
        return (!is_inside_dependencies(&path)).then(|| path.into_owned());
    };

    let root_dir = normalize_separators(root_dir);
    let relative = strip_root_prefix(&path, &root_dir)?;

    (!is_inside_dependencies(relative)).then(|| relative.to_string())
}

pub fn extract_absolute_path(filename: &FileName) -> Option<String> {
    match filename {
        FileName::Real(path) => path.to_str().map(|s| s.to_string()),
        FileName::Custom(custom) => Some(custom.clone()),
        _ => None,
    }
}
