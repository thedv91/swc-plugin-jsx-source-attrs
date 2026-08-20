use swc_core::common::FileName;

pub fn extract_absolute_path(filename: &FileName) -> Option<String> {
    match filename {
        FileName::Real(path) => path.to_str().map(|s| s.to_string()),
        FileName::Custom(custom) => Some(custom.clone()),
        _ => None,
    }
}
