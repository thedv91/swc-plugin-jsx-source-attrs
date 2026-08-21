use serde::{Deserialize, Serialize};

/// Source the plugin leaves alone even though it is project code.
///
/// Patterns are globs, not regexes — a config crosses into the plugin as JSON,
/// where a JavaScript `RegExp` serializes to `{}` and is lost. See `glob.rs`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IgnoreConfig {
    /// Project-relative paths to skip entirely, e.g. `*.test.tsx`.
    #[serde(default)]
    pub files: Vec<String>,

    /// Element names to leave unannotated, e.g. `*Lazy`. Their children are
    /// still annotated — this skips the element, not the subtree.
    #[serde(default)]
    pub components: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginConfig {
    /// Attribute name to emit (default: `data-tsd-source`)
    #[serde(default, rename = "source-path-attr")]
    pub source_path_attr: Option<String>,

    /// Project root the emitted path is made relative to. Relative values are
    /// resolved against the working directory; unset means the working
    /// directory itself.
    #[serde(default, rename = "root-dir")]
    pub root_dir: Option<String>,

    /// The same `root-dir` in the form a path the host already made
    /// project-relative can be measured against. Derived from `root-dir`, never
    /// configured on its own: `root_dir` is overwritten with its absolute
    /// resolution before the visitor runs, and an absolute root cannot be
    /// matched against a path that names no filesystem location, so the
    /// relative form has to be kept separately.
    #[serde(skip)]
    pub relative_root_dir: Option<String>,

    /// Append the element's own `:line:column` to the emitted path
    #[serde(default = "enabled", rename = "position")]
    pub position: bool,

    /// Files and components to leave unannotated
    #[serde(default, rename = "ignore")]
    pub ignore: IgnoreConfig,
}

fn enabled() -> bool {
    true
}

// Written out rather than derived so `PluginConfig::default()` and an empty
// JSON config agree on `position`.
impl Default for PluginConfig {
    fn default() -> Self {
        Self {
            source_path_attr: None,
            root_dir: None,
            relative_root_dir: None,
            ignore: IgnoreConfig::default(),
            position: true,
        }
    }
}

impl PluginConfig {
    pub fn source_path_attr_name(&self) -> &str {
        match self.source_path_attr {
            Some(ref custom) => custom,
            // The name the TanStack Devtools source inspector reads. It is
            // hardcoded there, so defaulting to anything else makes the empty
            // config `{}` useless with the one consumer that reads this
            // attribute off the shelf.
            None => "data-tsd-source",
        }
    }
}
