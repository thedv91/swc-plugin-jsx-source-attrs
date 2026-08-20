use std::path::PathBuf;
use swc_core::{
    common::{FileName, Mark},
    ecma::{
        ast::Pass,
        parser::{EsSyntax, Syntax},
        transforms::{
            base::resolver,
            testing::{test, test_fixture},
        },
        visit::visit_mut_pass,
    },
};
use swc_plugin_jsx_source_attrs::{config::PluginConfig, JsxSourceAttrsVisitor};

fn tr(config: PluginConfig, filename: FileName) -> impl Pass {
    let unresolved_mark = Mark::new();
    let top_level_mark = Mark::new();

    (
        resolver(unresolved_mark, top_level_mark, false),
        visit_mut_pass(JsxSourceAttrsVisitor::new(config, &filename)),
    )
}

#[test]
fn test_config_parsing() {
    let default_config = PluginConfig::default();
    assert_eq!(default_config.source_path_attr_name(), "data-source-path");

    let configured: PluginConfig =
        serde_json::from_str(r#"{ "source-path-attr": "data-tsd-source" }"#).unwrap();
    assert_eq!(configured.source_path_attr_name(), "data-tsd-source");

    // React Native rejects kebab-case props
    let native: PluginConfig = serde_json::from_str(r#"{ "native": true }"#).unwrap();
    assert_eq!(native.source_path_attr_name(), "dataSourcePath");

    // An explicit name wins over the native default
    let native_named: PluginConfig =
        serde_json::from_str(r#"{ "native": true, "source-path-attr": "sourceLoc" }"#).unwrap();
    assert_eq!(native_named.source_path_attr_name(), "sourceLoc");
}

#[testing::fixture("tests/fixture/*/input.jsx")]
fn fixture(input: PathBuf) {
    let dir = input.parent().unwrap().to_path_buf();
    let output = dir.join("output.jsx");
    let case = dir.file_name().unwrap().to_str().unwrap().to_string();

    let filename = FileName::Custom(format!("/mock/root/src/{}.jsx", case));

    test_fixture(
        Syntax::Es(EsSyntax {
            jsx: true,
            ..Default::default()
        }),
        &|_| tr(PluginConfig::default(), filename.clone()),
        &input,
        &output,
        Default::default(),
    );
}
