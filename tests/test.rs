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
fn test_project_relative_path() {
    use swc_plugin_jsx_source_attrs::path_utils::project_relative_path;

    let root = Some("/home/me/app");
    // Every case below is a filesystem path, where the Turbopack form of the
    // root has no say; it gets its own test.
    let project_relative_path =
        |path: &str, root_dir: Option<&str>| project_relative_path(path, root_dir, None);

    // Root dir with and without a trailing separator
    assert_eq!(
        project_relative_path("/home/me/app/src/Button.tsx", root),
        Some("src/Button.tsx".to_string())
    );
    assert_eq!(
        project_relative_path("/home/me/app/src/Button.tsx", Some("/home/me/app/")),
        Some("src/Button.tsx".to_string())
    );

    // A partial directory-name match is not the project: `/home/me/app` must
    // not swallow the `s` of `apps`
    assert_eq!(
        project_relative_path("/home/me/apps/web/Button.tsx", root),
        None
    );

    // Outside the root is outside the project
    assert_eq!(project_relative_path("/var/tmp/Button.tsx", root), None);

    // A dependency's own source is not project source, however it is reached
    assert_eq!(
        project_relative_path("/home/me/app/node_modules/some-lib/dist/index.js", root),
        None
    );
    assert_eq!(
        project_relative_path(
            "/home/me/app/node_modules/.pnpm/some-lib@1.0.0/node_modules/some-lib/index.js",
            root
        ),
        None
    );
    // ...and with no root configured the dependency check still applies
    assert_eq!(
        project_relative_path("/anywhere/node_modules/lib/index.js", None),
        None
    );
    assert_eq!(
        project_relative_path("/anywhere/src/Button.tsx", None),
        Some("/anywhere/src/Button.tsx".to_string())
    );

    // A directory merely containing the word is still project source
    assert_eq!(
        project_relative_path("/home/me/app/src/node_modules_shim/Button.tsx", root),
        Some("src/node_modules_shim/Button.tsx".to_string())
    );

    // Windows separators are normalized on both sides
    assert_eq!(
        project_relative_path(
            "C:\\Users\\Name\\project\\src\\Button.tsx",
            Some("C:/Users/Name/project")
        ),
        Some("src/Button.tsx".to_string())
    );

    // Turbopack addresses modules through a virtual root instead of the
    // filesystem, so the resolved absolute `root-dir` has no bearing on those
    assert_eq!(
        project_relative_path("[project]/src/Button.tsx", root),
        Some("src/Button.tsx".to_string())
    );
    assert_eq!(
        project_relative_path("[project]/src/Button.tsx", None),
        Some("src/Button.tsx".to_string())
    );
    assert_eq!(
        project_relative_path("[project]/node_modules/lib/index.js", root),
        None
    );
    // ...and any other virtual root is the bundler's own code
    assert_eq!(
        project_relative_path("[next]/dist/client/app.js", root),
        None
    );
    assert_eq!(project_relative_path("[externals]/react.js", None), None);

    // A host that hands us a relative path has already made it project-relative
    assert_eq!(
        project_relative_path("src/Button.tsx", root),
        Some("src/Button.tsx".to_string())
    );
    assert_eq!(
        project_relative_path("node_modules/lib/index.js", root),
        None
    );

    // An empty root dir filters nothing
    assert_eq!(
        project_relative_path("/home/me/app/src/Button.tsx", Some("")),
        Some("/home/me/app/src/Button.tsx".to_string())
    );
}

#[test]
fn test_relative_root_dir() {
    use swc_plugin_jsx_source_attrs::path_utils::relative_root_dir;

    // A root inside the project is the one form a `[project]/…` path can be
    // measured against
    assert_eq!(
        relative_root_dir(Some("apps/web")),
        Some("apps/web".to_string())
    );
    assert_eq!(
        relative_root_dir(Some("./apps/web/")),
        Some("apps/web".to_string())
    );
    assert_eq!(
        relative_root_dir(Some("apps\\web")),
        Some("apps/web".to_string())
    );

    // The project root itself narrows nothing, which an empty root already means
    assert_eq!(relative_root_dir(Some(".")), Some("".to_string()));

    // An absolute root names a location the virtual path never reveals, and a
    // root above the project root cannot contain a `[project]/…` path at all
    assert_eq!(relative_root_dir(Some("/repo/apps/web")), None);
    assert_eq!(relative_root_dir(Some("C:/repo")), None);
    assert_eq!(relative_root_dir(Some("../..")), None);
    assert_eq!(relative_root_dir(Some("apps/../..")), None);
    assert_eq!(relative_root_dir(None), None);

    // A directory that merely starts with two dots is an ordinary segment
    assert_eq!(
        relative_root_dir(Some("..hidden/web")),
        Some("..hidden/web".to_string())
    );
}

#[test]
fn test_project_relative_path_from_a_bundler() {
    use swc_plugin_jsx_source_attrs::path_utils::project_relative_path;

    // Next.js 16.3 hands over a plain project-relative path rather than the
    // `[project]/…` form Turbopack's docs describe, and both must take the root
    // the same way — annotating only the virtual form left `root-dir` inert on
    // the one shape Next.js actually produces
    assert_eq!(
        project_relative_path(
            "apps/web/src/Button.tsx",
            Some("/repo/apps/web"),
            Some("apps/web")
        ),
        Some("src/Button.tsx".to_string())
    );
    assert_eq!(
        project_relative_path("packages/ui/src/Button.tsx", None, Some("apps/web")),
        None
    );

    // In a monorepo Turbopack roots the project at the repo, so a package build
    // reports every file through the workspace prefix. A relative `root-dir`
    // drops it — this is the only thing that can, the absolute one alongside it
    // being unmatchable here
    assert_eq!(
        project_relative_path(
            "[project]/apps/web/src/Button.tsx",
            Some("/repo/apps/web"),
            Some("apps/web")
        ),
        Some("src/Button.tsx".to_string())
    );

    // A sibling package is outside the configured root, so it is not project
    // source — the same rule the filesystem branch applies
    assert_eq!(
        project_relative_path(
            "[project]/packages/ui/src/Button.tsx",
            None,
            Some("apps/web")
        ),
        None
    );

    // ...and a partial directory-name match is not the root either
    assert_eq!(
        project_relative_path(
            "[project]/apps/website/src/Button.tsx",
            None,
            Some("apps/web")
        ),
        None
    );

    // A dependency stays skipped however the root is stated
    assert_eq!(
        project_relative_path(
            "[project]/apps/web/node_modules/lib/index.js",
            None,
            Some("apps/web")
        ),
        None
    );

    // An empty root — what `root-dir: "."` resolves to — filters nothing
    assert_eq!(
        project_relative_path("[project]/apps/web/src/Button.tsx", None, Some("")),
        Some("apps/web/src/Button.tsx".to_string())
    );

    // Other virtual roots are the bundler's own code, root or no root
    assert_eq!(
        project_relative_path("[next]/dist/client/app.js", None, Some("apps/web")),
        None
    );
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
fn test_config_parsing() {
    // Position is on by default, and both entry points must agree on that
    let default_config = PluginConfig::default();
    assert!(default_config.position);
    assert_eq!(default_config.source_path_attr_name(), "data-source-path");

    let empty: PluginConfig = serde_json::from_str("{}").unwrap();
    assert!(empty.position);

    let configured: PluginConfig = serde_json::from_str(
        r#"{
        "source-path-attr": "data-tsd-source",
        "root-dir": "../..",
        "position": false
    }"#,
    )
    .unwrap();
    assert_eq!(configured.source_path_attr_name(), "data-tsd-source");
    assert_eq!(configured.root_dir, Some("../..".to_string()));
    assert!(!configured.position);

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

    // Cases prefixed `dependency_` stand in for a file the bundler pulled out
    // of node_modules; everything else is project source.
    let filename = FileName::Custom(match case.strip_prefix("dependency_") {
        Some(rest) => format!("/mock/root/node_modules/some-lib/dist/{}.js", rest),
        None => format!("/mock/root/src/{}.jsx", case),
    });

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
