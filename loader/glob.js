// A port of `src/glob.rs`, kept deliberately line-for-line with it: the loader
// and the plugin have to agree on what an `ignore` pattern covers, and the only
// way to keep two implementations agreeing is to keep them recognisable as the
// same code.

"use strict";

/**
 * Match `text` against a glob `pattern`, where `*` matches within one path
 * segment and `**` matches across separators.
 *
 * @param {string} pattern
 * @param {string} text
 * @returns {boolean}
 */
function matchesGlob(pattern, text) {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === text;

  const literal = pattern.slice(0, star);
  if (!text.startsWith(literal)) return false;
  text = text.slice(literal.length);

  let rest = pattern.slice(star);
  const crossesSeparators = rest.startsWith("**");
  rest = rest.slice(crossesSeparators ? 2 : 1);

  // How far the star itself may reach: to the end of the text, or only to the
  // end of the current segment.
  const separator = text.indexOf("/");
  const reach = crossesSeparators || separator === -1 ? text.length : separator;

  // A trailing star consumes everything within its reach, and matches only if
  // that is all there is.
  if (rest === "") return reach === text.length;

  // `**/` means "at any depth", and no depth at all is one of those: without
  // this, `src/**/*.gen.ts` would miss `src/routes.gen.ts`, because the star
  // can only ever match up to -- never past -- the separator that follows it.
  if (crossesSeparators && rest.startsWith("/") && matchesGlob(rest.slice(1), text)) {
    return true;
  }

  // Otherwise try every split point, starting at zero so the star may also
  // match nothing at all.
  for (let end = 0; end <= reach; end++) {
    if (matchesGlob(rest, text.slice(end))) return true;
  }
  return false;
}

/**
 * Whether `path` -- always project-relative here -- is covered by one of the
 * `ignore.files` patterns.
 *
 * A pattern with a separator is matched against the whole path; one without is
 * matched against each segment on its own, the rule `.gitignore` uses.
 *
 * @param {string} path
 * @param {string[]} patterns
 * @returns {boolean}
 */
function pathIsIgnored(path, patterns) {
  return patterns.some((pattern) =>
    pattern.includes("/")
      ? matchesGlob(pattern, path)
      : path.split("/").some((segment) => matchesGlob(pattern, segment)),
  );
}

/**
 * Whether an element's name is covered by one of the `ignore.components`
 * patterns. Matched whole: a component name has no separators to make a
 * partial match meaningful.
 *
 * @param {string} name
 * @param {string[]} patterns
 * @returns {boolean}
 */
function nameIsIgnored(name, patterns) {
  return patterns.some((pattern) => matchesGlob(pattern, name));
}

module.exports = { matchesGlob, pathIsIgnored, nameIsIgnored };
