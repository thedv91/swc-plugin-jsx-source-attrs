pub mod config;
pub mod glob;
pub mod path_utils;

use config::PluginConfig;
use glob::{name_is_ignored, path_is_ignored};
use path_utils::{
    extract_absolute_path, project_relative_path, relative_root_dir, resolve_root_dir,
};
use swc_core::{
    common::{FileName, SourceMapper, Span, DUMMY_SP},
    ecma::{
        ast::*,
        visit::{noop_visit_mut_type, VisitMut, VisitMutWith},
    },
    plugin::{
        metadata::TransformPluginMetadataContextKind, plugin_transform,
        proxies::TransformPluginProgramMetadata,
    },
};

/// A fragment emits no host node, so there is nothing to hang an attribute on.
/// Matched by name only: resolving aliases would mean tracking bindings, and a
/// component genuinely named `Fragment` is not worth that machinery.
fn is_fragment_name(name: &JSXElementName) -> bool {
    match name {
        JSXElementName::Ident(ident) => ident.sym == "Fragment",
        JSXElementName::JSXMemberExpr(member_expr) => {
            member_expr.prop.sym == "Fragment"
                && matches!(&member_expr.obj, JSXObject::Ident(obj) if obj.sym == "React")
        }
        _ => false,
    }
}

/// The element's name as it is written, so an `ignore` pattern can be matched
/// against what the author sees: `Foo`, `Foo.Bar`, `svg:rect`.
///
/// The wildcard arms below are load-bearing on `wasm32`, where the AST enums
/// come from a `swc_core` built with only `ecma_plugin_transform` and are
/// `#[non_exhaustive]` — the build fails without them. The native test build
/// pulls in more features, sees the same enums as closed, and calls the arms
/// unreachable. Only one of the two can be satisfied; the one that ships wins.
#[allow(unreachable_patterns)]
fn element_name(name: &JSXElementName) -> String {
    match name {
        JSXElementName::Ident(ident) => ident.sym.to_string(),
        JSXElementName::JSXMemberExpr(member_expr) => {
            let mut object = &member_expr.obj;
            let mut parts = vec![member_expr.prop.sym.to_string()];
            loop {
                match object {
                    JSXObject::Ident(ident) => {
                        parts.push(ident.sym.to_string());
                        break;
                    }
                    JSXObject::JSXMemberExpr(inner) => {
                        parts.push(inner.prop.sym.to_string());
                        object = &inner.obj;
                    }
                    _ => break,
                }
            }
            parts.reverse();
            parts.join(".")
        }
        JSXElementName::JSXNamespacedName(namespaced) => {
            format!("{}:{}", namespaced.ns.sym, namespaced.name.sym)
        }
        // The AST enum is `#[non_exhaustive]`. A name we cannot spell cannot be
        // written as a pattern either, so it matches nothing.
        _ => String::new(),
    }
}

pub struct JsxSourceAttrsVisitor {
    attr_ident: IdentName,
    /// The file path every element in this module reports, before any position
    /// suffix. `None` when the host gave us no usable filename.
    source_path: Option<Str>,
    /// Resolves a `BytePos` to line/column. Absent for native callers: the host
    /// proxy only answers inside wasm.
    source_map: Option<Box<dyn SourceMapper>>,
    position: bool,
    /// Element-name globs to leave unannotated. Empty for the common case, so
    /// the check costs nothing when the option is unused.
    ignored_components: Vec<String>,
}

impl JsxSourceAttrsVisitor {
    pub fn new(
        config: PluginConfig,
        filename: &FileName,
        source_map: Option<Box<dyn SourceMapper>>,
    ) -> Self {
        let source_path = extract_absolute_path(filename)
            .and_then(|value| {
                project_relative_path(
                    &value,
                    config.root_dir.as_deref(),
                    config.relative_root_dir.as_deref(),
                )
            })
            // An ignored file is dropped here rather than per element: the
            // whole module reports one path, so one check settles all of them.
            .filter(|value| !path_is_ignored(value, &config.ignore.files))
            .map(|value| Str {
                span: DUMMY_SP,
                value: value.into(),
                raw: None,
            });

        Self {
            attr_ident: IdentName::new(config.source_path_attr_name().into(), DUMMY_SP),
            source_path,
            source_map,
            position: config.position,
            ignored_components: config.ignore.components,
        }
    }

    fn attr_value(&self, span: Span) -> Option<Str> {
        let source_path = self.source_path.as_ref()?;

        if !self.position {
            return Some(source_path.clone());
        }

        let Some(source_map) = self.source_map.as_ref() else {
            // Native callers (the tests) have no host source map. Emit the bare
            // path rather than dropping the attribute.
            return Some(source_path.clone());
        };

        // This plugin runs after the other transforms, so the tree can contain
        // elements the React Compiler synthesized, which carry no source span.
        // Asking the host to resolve `BytePos(0)` panics with `NoFileFor`, and
        // a wasm plugin cannot catch that — so check before asking.
        if span.is_dummy() {
            return Some(source_path.clone());
        }

        // A path that is not valid UTF-8 cannot be concatenated; keep it whole
        // rather than losing the attribute over the suffix.
        let Some(path) = source_path.value.as_str() else {
            return Some(source_path.clone());
        };

        let loc = source_map.lookup_char_pos(span.lo);
        Some(Str {
            span: DUMMY_SP,
            // `col` counts characters and is 0-based; editors count characters
            // from 1. Not `col_display`, which counts *columns on screen* — it
            // widens a tab to the next stop and a CJK character to two, so an
            // editor sent there lands past the element. It is also what the
            // loader cannot reproduce, and the two have to agree.
            value: format!("{}:{}:{}", path, loc.line, loc.col.0 + 1).into(),
            raw: None,
        })
    }

    fn should_annotate(&self, opening_element: &JSXOpeningElement) -> bool {
        if is_fragment_name(&opening_element.name) {
            return false;
        }

        if !self.ignored_components.is_empty()
            && name_is_ignored(
                &element_name(&opening_element.name),
                &self.ignored_components,
            )
        {
            return false;
        }

        // Only named attributes are inspected. A spread cannot state the
        // attribute name here, and whatever it forwards at runtime is handled
        // by insertion order instead.
        for attr in &opening_element.attrs {
            if let JSXAttrOrSpread::JSXAttr(jsx_attr) = attr {
                // Written by hand, or by an earlier run over the same file.
                if matches!(&jsx_attr.name, JSXAttrName::Ident(ident) if ident.sym == self.attr_ident.sym)
                {
                    return false;
                }
            }
        }

        true
    }
}

impl VisitMut for JsxSourceAttrsVisitor {
    noop_visit_mut_type!();

    fn visit_mut_jsx_opening_element(&mut self, node: &mut JSXOpeningElement) {
        // Children first: appending before the walk would make the new
        // attribute part of what gets visited.
        node.visit_mut_children_with(self);

        if !self.should_annotate(node) {
            return;
        }

        let Some(value) = self.attr_value(node.span) else {
            return;
        };

        // Inserted first, never appended. A later `{...props}` then overwrites
        // it, which is what forwards a caller's annotation through a wrapper —
        // and it does so by JSX evaluation order, not by inspecting the code.
        // Inspecting was the old approach, and it broke under Turbopack, whose
        // client pipeline hands the plugin an already-transformed tree that no
        // longer looks like the source.
        node.attrs.insert(
            0,
            JSXAttrOrSpread::JSXAttr(JSXAttr {
                span: DUMMY_SP,
                name: JSXAttrName::Ident(self.attr_ident.clone()),
                value: Some(JSXAttrValue::Str(value)),
            }),
        );
    }
}

#[plugin_transform]
pub fn process_transform(
    mut program: Program,
    metadata: TransformPluginProgramMetadata,
) -> Program {
    let mut config = if let Some(config_str) = metadata.get_transform_plugin_config() {
        serde_json::from_str::<PluginConfig>(&config_str).unwrap_or_default()
    } else {
        PluginConfig::default()
    };

    let filename = if let Some(filename_str) =
        metadata.get_context(&TransformPluginMetadataContextKind::Filename)
    {
        FileName::Custom(filename_str)
    } else {
        FileName::Custom("unknown".to_string())
    };

    // The working directory is the default root, and the anchor a relative
    // `root-dir` is resolved against, so it has to be read from the host here
    // rather than inside the visitor.
    let cwd = metadata.get_context(&TransformPluginMetadataContextKind::Cwd);
    // Derived before `root_dir` is overwritten with its absolute resolution —
    // the Turbopack form needs the value as it was written.
    config.relative_root_dir = relative_root_dir(config.root_dir.as_deref());
    config.root_dir = resolve_root_dir(config.root_dir.as_deref(), cwd.as_deref());

    let mut visitor =
        JsxSourceAttrsVisitor::new(config, &filename, Some(Box::new(metadata.source_map)));

    // Without a path there is no attribute to emit, so the walk would visit
    // every node only to bail on each one. Dev builds hand the plugin plenty of
    // such modules — dependencies, and the bundler's own virtual roots.
    if visitor.source_path.is_none() {
        return program;
    }

    program.visit_mut_with(&mut visitor);
    program
}
