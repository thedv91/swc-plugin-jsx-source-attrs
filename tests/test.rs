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
        visit_mut_pass(JsxSourceAttrsVisitor::new(config, &filename, None)),
    )
}

#[test]
fn test_resolve_root_dir() {
    use swc_plugin_jsx_source_attrs::path_utils::resolve_root_dir;

    // No root-dir configured: the working directory is the root, so a build run
    // from a package directory needs no configuration at all
    assert_eq!(
        resolve_root_dir(None, Some("/repo/apps/web")),
        Some("/repo/apps/web".to_string())
    );

    // A relative root-dir is anchored to the working directory, which is what
    // makes one config correct on both a laptop and CI
    assert_eq!(
        resolve_root_dir(Some("../.."), Some("/repo/apps/web")),
        Some("/repo".to_string())
    );
    assert_eq!(
        resolve_root_dir(Some("."), Some("/repo/apps/web")),
        Some("/repo/apps/web".to_string())
    );

    // An absolute root-dir is taken verbatim, working directory ignored
    assert_eq!(
        resolve_root_dir(Some("/somewhere/else"), Some("/repo/apps/web")),
        Some("/somewhere/else".to_string())
    );

    // Windows separators and drives on either side
    assert_eq!(
        resolve_root_dir(Some("..\\.."), Some("C:\\repo\\apps\\web")),
        Some("C:/repo".to_string())
    );

    // Climbing past the root stops at the root rather than escaping it
    assert_eq!(
        resolve_root_dir(Some("../../../../.."), Some("/repo")),
        Some("/".to_string())
    );

    // Without a working directory there is nothing to configure a root from
    assert_eq!(resolve_root_dir(None, None), None);

    // ...and a relative root-dir stays unanchored, so it fails to match and the
    // path is left absolute instead of being stripped against the wrong prefix
    assert_eq!(
        resolve_root_dir(Some("../.."), None),
        Some("../..".to_string())
    );
}

#[test]
fn test_relativize_path() {
    use swc_plugin_jsx_source_attrs::path_utils::relativize_path;

    // Root dir with and without a trailing separator
    assert_eq!(
        relativize_path("/home/me/app/src/Button.tsx", "/home/me/app"),
        "src/Button.tsx"
    );
    assert_eq!(
        relativize_path("/home/me/app/src/Button.tsx", "/home/me/app/"),
        "src/Button.tsx"
    );

    // A partial directory-name match must not be stripped
    assert_eq!(
        relativize_path("/home/me/apps/web/Button.tsx", "/home/me/app"),
        "/home/me/apps/web/Button.tsx"
    );

    // Windows separators are normalized on both sides
    assert_eq!(
        relativize_path(
            "C:\\Users\\Name\\project\\src\\Button.tsx",
            "C:/Users/Name/project"
        ),
        "src/Button.tsx"
    );

    // An empty root dir is a no-op
    assert_eq!(
        relativize_path("/home/me/app/src/Button.tsx", ""),
        "/home/me/app/src/Button.tsx"
    );
}

#[test]
fn test_config_parsing() {
    // Position is on by default, and both entry points must agree on that
    let default_config = PluginConfig::default();
    assert!(default_config.position);
    assert_eq!(default_config.source_path_attr_name(), "data-source-path");

    let empty: PluginConfig = serde_json::from_str("{}").unwrap();
    assert!(empty.position);

    let configured: PluginConfig =
        serde_json::from_str(r#"{ "source-path-attr": "data-tsd-source", "root-dir": "../.." }"#)
            .unwrap();
    assert_eq!(configured.source_path_attr_name(), "data-tsd-source");
    assert_eq!(configured.root_dir, Some("../..".to_string()));

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

    let config = PluginConfig {
        root_dir: Some("/mock/root".to_string()),
        // The fixtures run natively, where no host source map exists, so
        // positions are covered by the e2e suite instead.
        position: false,
        ..Default::default()
    };

    let filename = FileName::Custom(format!("/mock/root/src/{}.jsx", case));

    test_fixture(
        Syntax::Es(EsSyntax {
            jsx: true,
            ..Default::default()
        }),
        &|_| tr(config.clone(), filename.clone()),
        &input,
        &output,
        Default::default(),
    );
}
