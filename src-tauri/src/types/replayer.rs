use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerResponse {
    pub response_time: u128,
    pub request_raw: String,
    pub response_raw: String,
    pub base_url: String, // baseUrl is the base URL of the request, e.g., "https://example.com" or "https://example.com:8080"
}

// #[derive(Debug, Clone, Serialize, Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct ReplayerRequest {
//     pub request_tmp: String,
//     pub url: String,
// }
