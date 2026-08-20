pub mod config;
pub mod path_utils;

use config::PluginConfig;
use path_utils::{extract_absolute_path, relativize_path, resolve_root_dir};
use swc_core::{
    common::{FileName, DUMMY_SP},
    ecma::{
        ast::*,
        atoms::Atom,
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

/// The identifier a function binds its whole props object to, if any:
/// `(props) => …` or `({ ...rest }) => …`.
fn props_name(first_param: Option<&Pat>) -> Option<Atom> {
    match first_param? {
        Pat::Ident(ident) => Some(ident.id.sym.clone()),
        Pat::Object(object) => object.props.iter().find_map(|prop| match prop {
            ObjectPatProp::Rest(rest) => match rest.arg.as_ref() {
                Pat::Ident(ident) => Some(ident.id.sym.clone()),
                _ => None,
            },
            _ => None,
        }),
        _ => None,
    }
}

pub struct JsxSourceAttrsVisitor {
    attr_ident: IdentName,
    /// The path every element in this module reports. `None` when the host gave
    /// us no usable filename.
    source_path: Option<Str>,
    /// Name bound to the enclosing function's props object, if any.
    current_props_name: Option<Atom>,
}

impl JsxSourceAttrsVisitor {
    pub fn new(config: PluginConfig, filename: &FileName) -> Self {
        let source_path = extract_absolute_path(filename)
            .map(|value| match config.root_dir.as_deref() {
                Some(root_dir) => relativize_path(&value, root_dir),
                None => value,
            })
            .map(|value| Str {
                span: DUMMY_SP,
                value: value.into(),
                raw: None,
            });

        Self {
            attr_ident: IdentName::new(config.source_path_attr_name().into(), DUMMY_SP),
            source_path,
            current_props_name: None,
        }
    }

    fn should_annotate(&self, opening_element: &JSXOpeningElement) -> bool {
        if is_fragment_name(&opening_element.name) {
            return false;
        }

        for attr in &opening_element.attrs {
            match attr {
                JSXAttrOrSpread::JSXAttr(jsx_attr) => {
                    // Written by hand, or by an earlier run over the same file.
                    if matches!(&jsx_attr.name, JSXAttrName::Ident(ident) if ident.sym == self.attr_ident.sym)
                    {
                        return false;
                    }
                }
                JSXAttrOrSpread::SpreadElement(spread) => {
                    // Spreading the enclosing props forwards whatever the
                    // caller already annotated. Appending here would win over
                    // the spread and replace the caller's real position with
                    // this wrapper's.
                    let Some(props_name) = self.current_props_name.as_ref() else {
                        continue;
                    };
                    if matches!(spread.expr.as_ref(), Expr::Ident(ident) if ident.sym == *props_name)
                    {
                        return false;
                    }
                }
                // The wasm build adds an `Unknown` variant (see
                // `.cargo/config.toml`), which the native build does not have.
                #[cfg(swc_ast_unknown)]
                _ => {}
            }
        }

        true
    }

    fn visit_with_props_name<N>(&mut self, node: &mut N, props_name: Option<Atom>)
    where
        N: VisitMutWith<Self>,
    {
        let previous = std::mem::replace(&mut self.current_props_name, props_name);
        node.visit_mut_children_with(self);
        self.current_props_name = previous;
    }
}

impl VisitMut for JsxSourceAttrsVisitor {
    noop_visit_mut_type!();

    fn visit_mut_function(&mut self, node: &mut Function) {
        let props_name = props_name(node.params.first().map(|param| &param.pat));
        self.visit_with_props_name(node, props_name);
    }

    fn visit_mut_arrow_expr(&mut self, node: &mut ArrowExpr) {
        let props_name = props_name(node.params.first());
        self.visit_with_props_name(node, props_name);
    }

    fn visit_mut_jsx_opening_element(&mut self, node: &mut JSXOpeningElement) {
        // Children first: appending before the walk would make the new
        // attribute part of what gets visited.
        node.visit_mut_children_with(self);

        if !self.should_annotate(node) {
            return;
        }

        let Some(source_path) = self.source_path.as_ref() else {
            return;
        };

        node.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
            span: DUMMY_SP,
            name: JSXAttrName::Ident(self.attr_ident.clone()),
            value: Some(JSXAttrValue::Str(source_path.clone())),
        }));
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
    config.root_dir = resolve_root_dir(config.root_dir.as_deref(), cwd.as_deref());

    let mut visitor = JsxSourceAttrsVisitor::new(config, &filename);
    program.visit_mut_with(&mut visitor);
    program
}
