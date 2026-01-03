use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerResponse {
    pub response_time: u128,
    pub request_raw: String,
    pub response_raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerRequest {
    pub request_tmp: String,
    pub url: String,
}
