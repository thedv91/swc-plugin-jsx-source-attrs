//! A small glob matcher for the `ignore` patterns.
//!
//! Deliberately not a regex engine. The `regex` crate would add a few hundred
//! kilobytes to a wasm module that ships to every dev build, and would have to
//! recompile the patterns for every file, since a plugin keeps no state between
//! invocations. Globs cover what the option is for — "the test files", "the lazy
//! components" — in a syntax people already write in `.gitignore`.

/// Match `text` against a glob `pattern`, where `*` matches within one path
/// segment and `**` matches across separators.
///
/// Backtracking is bounded by the number of `*` in the pattern, which is small
/// enough that the naive recursion cannot get expensive here.
fn matches_glob(pattern: &str, text: &str) -> bool {
    let Some(star) = pattern.find('*') else {
        return pattern == text;
    };

    let (literal, rest) = pattern.split_at(star);
    let Some(text) = text.strip_prefix(literal) else {
        return false;
    };

    let (crosses_separators, rest) = match rest.strip_prefix("**") {
        Some(rest) => (true, rest),
        None => (false, &rest[1..]),
    };

    // How far the star itself may reach: to the end of the text, or only to the
    // end of the current segment.
    let reach = if crosses_separators {
        text.len()
    } else {
        text.find('/').unwrap_or(text.len())
    };

    // A trailing star consumes everything within its reach, and matches only if
    // that is all there is.
    if rest.is_empty() {
        return reach == text.len();
    }

    // `**/` means "at any depth", and no depth at all is one of those: without
    // this, `src/**/*.gen.ts` would miss `src/routes.gen.ts`, because the star
    // can only ever match up to — never past — the separator that follows it.
    if crosses_separators {
        if let Some(rest) = rest.strip_prefix('/') {
            if matches_glob(rest, text) {
                return true;
            }
        }
    }

    // Otherwise try every split point, starting at zero so the star may also
    // match nothing at all.
    (0..=reach)
        .filter(|end| text.is_char_boundary(*end))
        .any(|end| matches_glob(rest, &text[end..]))
}

/// Whether `path` — always project-relative here — is covered by one of the
/// `ignore.files` patterns.
///
/// A pattern with a separator is matched against the whole path; one without is
/// matched against each segment on its own. That is the rule `.gitignore` uses,
/// and it is what makes the two obvious patterns behave as written: `dist`
/// covers the directory wherever it sits, and `*.test.tsx` covers the file
/// whatever directory it sits in.
pub fn path_is_ignored(path: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|pattern| {
        if !pattern.contains('/') {
            return path
                .split('/')
                .any(|segment| matches_glob(pattern, segment));
        }

        matches_glob(pattern, path)
    })
}

/// Whether an element's name is covered by one of the `ignore.components`
/// patterns. Matched whole: a component name has no separators to make a
/// partial match meaningful.
pub fn name_is_ignored(name: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|pattern| matches_glob(pattern, name))
}
