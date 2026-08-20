use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginConfig {
    /// Attribute name to emit (default: `data-source-path`)
    #[serde(default, rename = "source-path-attr")]
    pub source_path_attr: Option<String>,

    /// Project root the emitted path is made relative to. Relative values are
    /// resolved against the working directory; unset means the working
    /// directory itself.
    #[serde(default, rename = "root-dir")]
    pub root_dir: Option<String>,

    /// Append the element's own `:line:column` to the emitted path
    #[serde(default = "enabled", rename = "position")]
    pub position: bool,

    /// Use a camelCase attribute name for React Native, which rejects
    /// kebab-case props
    #[serde(default, rename = "native")]
    pub native: bool,
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
            position: true,
            native: false,
        }
    }
}

impl PluginConfig {
    pub fn source_path_attr_name(&self) -> &str {
        if let Some(ref custom) = self.source_path_attr {
            custom
        } else if self.native {
            "dataSourcePath"
        } else {
            "data-source-path"
        }
    }
}
