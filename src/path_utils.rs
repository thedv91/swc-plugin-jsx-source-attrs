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
        Some(cwd) => Some(normalize_dots(&format!(
            "{}/{}",
            cwd.trim_end_matches('/'),
            root_dir
        ))),
        // With no working directory a relative root-dir has nothing to anchor
        // to. Keep it as written so it simply fails to match and the path stays
        // absolute, rather than stripping some unrelated prefix.
        None => Some(normalize_dots(&root_dir)),
    }
}

fn is_inside_dependencies(path: &str) -> bool {
    path.split('/').any(|segment| segment == "node_modules")
}

/// Turbopack does not hand plugins filesystem paths. It addresses every module
/// through a virtual root: `[project]/src/App.tsx` for your own source, and
/// `[next]/…`, `[externals]/…` and friends for what the bundler injects.
const TURBOPACK_PROJECT_ROOT: &str = "[project]/";

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
pub fn project_relative_path(path: &str, root_dir: Option<&str>) -> Option<String> {
    let path = normalize_separators(path);

    // Under Turbopack the path is already project-relative once its virtual
    // root is removed, and `root-dir` has nothing to say about it.
    if let Some(relative) = path.strip_prefix(TURBOPACK_PROJECT_ROOT) {
        return (!is_inside_dependencies(relative)).then(|| relative.to_string());
    }

    // Any other virtual root is the bundler's own code, not the project's.
    if path.starts_with('[') {
        return None;
    }

    // A host that hands us a relative path has already made it relative to the
    // project; measuring it against an absolute root would only reject it.
    if !is_absolute(&path) {
        return (!is_inside_dependencies(&path)).then(|| path.into_owned());
    }

    let Some(root_dir) = root_dir else {
        // With no root there is nothing to measure "inside the project"
        // against, so only the dependency check can apply.
        return (!is_inside_dependencies(&path)).then(|| path.into_owned());
    };

    let root_dir = normalize_separators(root_dir);
    let root_dir = root_dir.trim_end_matches('/');

    let relative = if root_dir.is_empty() {
        path.as_ref()
    } else {
        // Only a separator marks a real directory boundary: `/app` must not
        // match `/apps/web/Button.tsx` and eat the `s`.
        let stripped = path.strip_prefix(root_dir)?;
        if !stripped.starts_with('/') {
            return None;
        }
        stripped.trim_start_matches('/')
    };

    (!is_inside_dependencies(relative)).then(|| relative.to_string())
}

pub fn extract_absolute_path(filename: &FileName) -> Option<String> {
    match filename {
        FileName::Real(path) => path.to_str().map(|s| s.to_string()),
        FileName::Custom(custom) => Some(custom.clone()),
        _ => None,
    }
}
