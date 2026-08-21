// A webpack/Turbopack loader that stamps the same attribute as the wasm plugin,
// but at the source level.
//
// The plugin cannot choose where it sits in the transform chain -- it runs
// after the host's own transforms, and the React Compiler is one of them. The
// compiler rebuilds the JSX tree with no source spans, so by the time the
// plugin is asked there is no position left to report and it emits the bare
// path. Inserting here, before the host's pipeline runs at all, makes the
// position an ordinary string literal, which every later transform carries
// through untouched.
//
// Text is spliced rather than regenerated: every insertion stays on the line it
// belongs to, so line numbers in the output still match the source and only
// columns shift. That is also why the incoming source map is passed through
// unchanged.

"use strict";

const { parse } = require("./parser.js");
const { nameIsIgnored, pathIsIgnored } = require("./glob.js");
const { projectRelativePath, resolveRootDir } = require("./paths.js");

const DEFAULT_ATTR = "data-tsd-source";

/**
 * @typedef {import("@babel/types").Node} Node
 * @typedef {import("@babel/types").JSXOpeningElement["name"]} JSXElementName
 */

/**
 * The element's name as it is written, so an `ignore` pattern can be matched
 * against what the author sees: `Foo`, `Foo.Bar`, `svg:rect`.
 *
 * @param {JSXElementName} name
 * @returns {string}
 */
function elementName(name) {
  switch (name.type) {
    case "JSXIdentifier":
      return name.name;
    case "JSXNamespacedName":
      return `${name.namespace.name}:${name.name.name}`;
    case "JSXMemberExpression": {
      const parts = [name.property.name];
      /** @type {import("@babel/types").JSXMemberExpression["object"]} */
      let object = name.object;
      while (object.type === "JSXMemberExpression") {
        parts.push(object.property.name);
        object = object.object;
      }
      if (object.type === "JSXIdentifier") parts.push(object.name);
      return parts.reverse().join(".");
    }
    default:
      return "";
  }
}

/**
 * A fragment emits no host node, so there is nothing to hang an attribute on.
 * Matched by name only, as in the plugin: resolving aliases would mean tracking
 * bindings, and a component genuinely named `Fragment` is not worth that.
 *
 * @param {JSXElementName} name
 */
function isFragmentName(name) {
  if (name.type === "JSXIdentifier") return name.name === "Fragment";
  if (name.type === "JSXMemberExpression") {
    return (
      name.property.name === "Fragment" &&
      name.object.type === "JSXIdentifier" &&
      name.object.name === "React"
    );
  }
  return false;
}

/**
 * @param {unknown} value
 * @returns {value is Node}
 */
function isNode(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (/** @type {any} */ (value).type) === "string"
  );
}

/** @param {string} filename */
function parserPlugins(filename) {
  /** @type {import("@babel/parser").ParserPlugin[]} */
  const plugins = ["jsx"];
  if (/\.[cm]?tsx?$/.test(filename)) plugins.push("typescript");
  else plugins.push("flow");
  return plugins;
}

/**
 * @typedef {object} AnnotateOptions
 * @property {string} sourcePath   Project-relative path to emit.
 * @property {string} [attr]       Attribute name (default `data-tsd-source`).
 * @property {boolean} [position]  Append `:line:column` (default `true`).
 * @property {string[]} [ignoreComponents] Element-name globs to skip.
 * @property {string} [filename]   Real filename, used only to pick the parser.
 */

/**
 * Insert the attribute into every eligible JSX element of `source`.
 *
 * Exported so the behaviour can be tested, and driven, without a bundler.
 *
 * @param {string} source
 * @param {AnnotateOptions} options
 * @returns {string}
 */
function annotate(source, options) {
  const attr = options.attr ?? DEFAULT_ATTR;
  const position = options.position ?? true;
  const ignoreComponents = options.ignoreComponents ?? [];

  let ast;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: parserPlugins(options.filename ?? ""),
    });
  } catch {
    // A file this loader cannot parse is still a file the bundler is about to
    // report on properly, and it is not always broken: `errorRecovery` only
    // covers errors Babel can recover *from*, so valid syntax needing a plugin
    // this loader does not enable -- decorators, most obviously -- throws here.
    // Handing the source back unannotated loses an attribute; throwing would
    // lose the build, and blame the loader for code it merely could not read.
    return source;
  }

  /** @type {{pos: number, text: string}[]} */
  const edits = [];

  /** @param {Node} node */
  const visit = (node) => {
    if (node.type === "JSXOpeningElement" && !isFragmentName(node.name)) {
      const written = node.attributes.some(
        (attribute) => attribute.type === "JSXAttribute" && attribute.name.name === attr,
      );
      const ignored =
        ignoreComponents.length > 0 && nameIsIgnored(elementName(node.name), ignoreComponents);

      if (!written && !ignored) {
        // Columns are counted from 1, the way an editor reports them --
        // Babel's are 0-based. `loc` is optional on the node type (a node built
        // by hand has none); one read from the parser always carries it, and a
        // file path alone is still worth emitting if that ever changes.
        const suffix =
          position && node.loc ? `:${node.loc.start.line}:${node.loc.start.column + 1}` : "";
        // A JSX attribute value is XML-like, not a JS string: a `"` inside it
        // ends the value, and a backslash escape does not save it. Paths with
        // a quote in them are vanishingly rare and completely legal, and the
        // failure mode is a syntax error in the user's own file, so spend the
        // one `replace` rather than the support thread.
        const value = `${options.sourcePath}${suffix}`.replaceAll('"', "&quot;");
        // Type arguments sit between the name and the attributes
        // (`<Table<Row> …>`); inserting before them splits the generic. v7
        // calls the node `typeParameters` and only v8's types know the newer
        // name, so the old one is read through a cast rather than dropped.
        const typeParameters = /** @type {{typeParameters?: {end: number}}} */ (node)
          .typeParameters;
        // `end`, like `loc`, is optional on the node type and always set on
        // anything the parser produced. Nothing to anchor to means nothing to
        // insert, rather than an insertion at a guessed offset.
        const end = (node.typeArguments ?? typeParameters ?? node.name).end;
        if (end != null) edits.push({ pos: end, text: ` ${attr}="${value}"` });
      }
    }

    // Walking by key rather than with `@babel/traverse`, which is a much larger
    // dependency for a walk this shallow. The cast is the price: a `Node` union
    // has no index signature, and narrowing 200-odd node types to find the ones
    // holding children would cost more than it could catch.
    for (const value of Object.values(
      /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (node)),
    )) {
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  };

  visit(ast.program);
  if (edits.length === 0) return source;

  // Inserted directly after the element name, so the attribute comes first and
  // a later `{...props}` overwrites it -- which is what forwards a caller's
  // annotation through a wrapper, by JSX evaluation order rather than by
  // inspecting the code. Same rule as the plugin's `attrs.insert(0, …)`.
  edits.sort((a, b) => a.pos - b.pos);
  const parts = [];
  let cursor = 0;
  for (const edit of edits) {
    parts.push(source.slice(cursor, edit.pos), edit.text);
    cursor = edit.pos;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}

/**
 * Written as an object type rather than with `@property`, which cannot name a
 * key containing a dash -- and these are the plugin's own option names.
 *
 * @typedef {{
 *   "source-path-attr"?: string,
 *   "root-dir"?: string,
 *   position?: boolean,
 *   ignore?: {files?: string[], components?: string[]},
 * }} LoaderOptions
 */

/**
 * The `ignore` patterns, checked to be globs.
 *
 * The plugin never has to do this: its config crosses into wasm as JSON, where
 * a `RegExp` has already collapsed to `{}` and quietly matches nothing. Here
 * the object arrives intact, so a config ported from TanStack Devtools -- which
 * does take regexes -- reaches a glob matcher that calls `.indexOf` on it. That
 * is a `TypeError` from inside a loader, on the first file, naming neither the
 * option nor the fix; this says both, once.
 *
 * @param {unknown} patterns
 * @param {string} option
 * @returns {string[]}
 */
function globPatterns(patterns, option) {
  if (patterns === undefined) return [];
  if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== "string")) {
    throw new TypeError(
      `swc-plugin-jsx-source-attrs/loader: \`${option}\` must be an array of glob strings. ` +
        "Regexes are not accepted -- `*` stays within a path segment, `**` crosses separators.",
    );
  }
  return patterns;
}

/**
 * @this {any}
 * @param {string} source
 * @param {any} [map]
 */
function jsxSourceAttrsLoader(source, map) {
  this.cacheable?.(true);

  const resourcePath = this.resourcePath ?? "";
  // `.js`, `.mjs` and `.cjs` are in: plenty of projects still write JSX in
  // them, and a rule that names them is a clear enough statement of intent.
  // `.ts` is not, and cannot be -- with the `jsx` plugin on, `<T>(x) => x`
  // parses as an unclosed element rather than a generic arrow.
  if (!/\.[cm]?jsx?$|\.[cm]?tsx$/.test(resourcePath)) {
    return this.callback ? this.callback(null, source, map) : source;
  }

  /** @type {LoaderOptions} */
  const options = (this.getOptions ? this.getOptions() : this.query) ?? {};
  const ignore = options.ignore ?? {};
  const ignoredFiles = globPatterns(ignore.files, "ignore.files");
  const ignoredComponents = globPatterns(ignore.components, "ignore.components");

  // `rootContext` is the compiler's context directory, which is where a build
  // is configured from rather than where it was launched from; the plugin has
  // only the host's working directory to go on. The two agree in every layout
  // either one is used in, but a `root-dir` relative to one is not relative to
  // the other if they ever diverge.
  const rootDir = resolveRootDir(options["root-dir"], this.rootContext ?? process.cwd());
  const sourcePath = projectRelativePath(resourcePath, rootDir);

  // Not project source -- outside the root, or inside a dependency. The whole
  // module is dropped here rather than per element: one path, one check.
  if (sourcePath === undefined) {
    return this.callback ? this.callback(null, source, map) : source;
  }
  if (ignoredFiles.length > 0 && pathIsIgnored(sourcePath, ignoredFiles)) {
    return this.callback ? this.callback(null, source, map) : source;
  }

  const output = annotate(source, {
    sourcePath,
    filename: resourcePath,
    ignoreComponents: ignoredComponents,
    ...(options["source-path-attr"] !== undefined ? { attr: options["source-path-attr"] } : {}),
    ...(options.position !== undefined ? { position: options.position } : {}),
  });

  return this.callback ? this.callback(null, output, map) : output;
}

// `Object.assign` rather than three statements: assigning onto a function that
// is already `module.exports` is an export shape TypeScript refuses to describe.
module.exports = Object.assign(jsxSourceAttrsLoader, {
  default: jsxSourceAttrsLoader,
  annotate,
});
