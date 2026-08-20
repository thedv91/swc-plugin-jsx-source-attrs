pub mod config;
pub mod path_utils;

use config::PluginConfig;
use path_utils::extract_absolute_path;
use swc_core::{
    common::{FileName, DUMMY_SP},
    ecma::{
        ast::*,
        visit::{noop_visit_mut_type, VisitMut, VisitMutWith},
    },
    plugin::{
        metadata::TransformPluginMetadataContextKind, plugin_transform,
        proxies::TransformPluginProgramMetadata,
    },
};

pub struct JsxSourceAttrsVisitor {
    attr_ident: IdentName,
    /// The path every element in this module reports. `None` when the host gave
    /// us no usable filename.
    source_path: Option<Str>,
}

impl JsxSourceAttrsVisitor {
    pub fn new(config: PluginConfig, filename: &FileName) -> Self {
        let source_path = extract_absolute_path(filename).map(|value| Str {
            span: DUMMY_SP,
            value: value.into(),
            raw: None,
        });

        Self {
            attr_ident: IdentName::new(config.source_path_attr_name().into(), DUMMY_SP),
            source_path,
        }
    }
}

impl VisitMut for JsxSourceAttrsVisitor {
    noop_visit_mut_type!();

    fn visit_mut_jsx_opening_element(&mut self, node: &mut JSXOpeningElement) {
        // Children first: appending before the walk would make the new
        // attribute part of what gets visited.
        node.visit_mut_children_with(self);

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
    let config = if let Some(config_str) = metadata.get_transform_plugin_config() {
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

    let mut visitor = JsxSourceAttrsVisitor::new(config, &filename);
    program.visit_mut_with(&mut visitor);
    program
}
