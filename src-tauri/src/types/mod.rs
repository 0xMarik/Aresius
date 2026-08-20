// src-tauri/src/types.rs (or in main.rs)
pub mod replayer;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPayload {
    pub raw_request: String,
    pub parameters: Vec<FuzzerParameter>,
    pub metadata: PayloadMetadata,
    pub delay_ms: u64,
    #[serde(default)]
    pub fuzzing_attack_type: Option<String>,
    #[serde(default)]
    pub num_threads: Option<usize>,
    #[serde(default)]
    pub pipeline_scope: Option<String>,
    #[serde(default)]
    pub pipeline_rules: Option<Vec<PreprocessingRule>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadMetadata {
    pub target_url: String,
    #[serde(default)]
    pub url_is_valid: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerParameter {
    pub payload_source: String,
    pub values: Vec<String>,
    pub highlight_range: HighlightRange,
    #[serde(default)]
    pub pipeline_rules: Option<Vec<PreprocessingRule>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRange {
    pub id: String,
    pub from: i64,
    pub to: i64,
    pub byte_from: i64,
    pub byte_to: i64,
    pub original_text: String,
    pub is_active: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReqRes {
    pub request: String,
    pub response: String,
    pub response_time: u128,
}
