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

// #[derive(Debug, Clone, Serialize, Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct FuzzingHistory {
//     pub date: String, // or use chrono::DateTime if you want proper dates
//     pub requests: Vec<FuzzerRequest>,
// }

// #[derive(Debug, Clone, Serialize, Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct FuzzerRequest {
//     pub target_url: String,
//     pub request: String,
//     pub response: String,
//     pub request_date: String,
//     pub status: RequestStatus,
// }

// #[derive(Debug, Clone, Serialize, Deserialize)]
// #[serde(rename_all = "lowercase")]
// pub enum RequestStatus {
//     Pending,
//     Completed,
//     Error,
// }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPayload {
    pub raw_request: String,
    pub parameters: Vec<FuzzerParameter>,
    pub metadata: PayloadMetadata,
    pub delay_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadMetadata {
    pub target_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerParameter {
    pub payload_source: PayloadSource,
    pub values: Vec<String>,
    pub highlight_range: HighlightRange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PayloadSource {
    Manual,
    Wordlist,
    Generator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRange {
    pub id: String,
    pub from: i32,
    pub to: i32,
    pub original_text: String,
    pub is_active: bool,
}

#[derive(Serialize, Debug)]
pub struct ReqRes {
    pub request: String,
    pub response: String,
    pub response_time: u128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FuzzingAttackType {
    /// Single payload set, iterates through one position at a time
    Rotator,
    /// Single payload set, same value in all positions
    Echo,
    /// Multiple payload sets, parallel iteration
    Zipped,
    /// Multiple payload sets, all combinations
    Combinatorial,
}
