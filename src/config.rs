use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginConfig {
    /// Attribute name to emit (default: `data-source-path`)
    #[serde(default, rename = "source-path-attr")]
    pub source_path_attr: Option<String>,

    /// Use a camelCase attribute name for React Native, which rejects
    /// kebab-case props
    #[serde(default, rename = "native")]
    pub native: bool,
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
