// src-tauri/src/types.rs (or in main.rs)
pub mod replayer;
pub mod match_replace;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerSession {
    pub name: String,
    // pub fuzzing_history: Vec<FuzzingHistory>,
    pub fuzz_config: SessionPayload,
    pub selected_highlight_id: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreprocessingRule {
    pub id: String,
    #[serde(rename = "type")]
    pub rule_type: String,
    #[serde(default)]
    pub case_option: Option<String>,
    #[serde(default)]
    pub encode_option: Option<String>,
    #[serde(default)]
    pub decode_option: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub pattern: Option<String>,
    #[serde(default)]
    pub replacement: Option<String>,
    #[serde(default)]
    pub is_regex: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionPayload {
    #[serde(default)]
    pub raw_request: String,
    #[serde(default)]
    pub parameters: Vec<FuzzerParameter>,
    #[serde(default)]
    pub metadata: PayloadMetadata,
    #[serde(default)]
    pub delay_ms: u64,
    #[serde(default)]
    pub fuzzing_attack_type: Option<String>,
    #[serde(default)]
    pub num_threads: Option<usize>,
    #[serde(default)]
    pub pipeline_scope: Option<String>,
    #[serde(default)]
    pub pipeline_rules: Option<Vec<PreprocessingRule>>,
    #[serde(default)]
    pub set_connection_keep_alive: Option<bool>,
    #[serde(default)]
    pub update_content_length: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PayloadMetadata {
    #[serde(default)]
    pub target_url: String,
    #[serde(default)]
    pub url_is_valid: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerParameter {
    #[serde(default)]
    pub payload_source: String,
    #[serde(default)]
    pub values: Vec<String>,
    #[serde(default)]
    pub highlight_range: HighlightRange,
    #[serde(default)]
    pub pipeline_rules: Option<Vec<PreprocessingRule>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRange {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub from: i64,
    #[serde(default)]
    pub to: i64,
    #[serde(default)]
    pub byte_from: i64,
    #[serde(default)]
    pub byte_to: i64,
    #[serde(default)]
    pub original_text: String,
    #[serde(default)]
    pub is_active: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReqRes {
    pub request: String,
    pub response: String,
    pub response_time: u128,
}
