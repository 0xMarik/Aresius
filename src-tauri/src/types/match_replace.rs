use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchReplaceType {
    RequestHeader,
    RequestBody,
    RequestParamName,
    RequestParamValue,
    RequestFirstLine,
    ResponseHeader,
    ResponseBody,
}

impl MatchReplaceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::RequestHeader => "request_header",
            Self::RequestBody => "request_body",
            Self::RequestParamName => "request_param_name",
            Self::RequestParamValue => "request_param_value",
            Self::RequestFirstLine => "request_first_line",
            Self::ResponseHeader => "response_header",
            Self::ResponseBody => "response_body",
        }
    }

    pub fn from_str_val(s: &str) -> Self {
        match s {
            "request_header" => Self::RequestHeader,
            "request_body" => Self::RequestBody,
            "request_param_name" => Self::RequestParamName,
            "request_param_value" => Self::RequestParamValue,
            "request_first_line" => Self::RequestFirstLine,
            "response_header" => Self::ResponseHeader,
            "response_body" => Self::ResponseBody,
            _ => Self::RequestHeader,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchReplaceRule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    #[serde(rename = "type")]
    pub rule_type: String,
    #[serde(rename = "match")]
    pub match_pattern: String,
    #[serde(default)]
    pub replace: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub is_regex: Option<bool>,
    #[serde(default)]
    pub is_case_sensitive: Option<bool>,
    #[serde(default)]
    pub only_in_scope: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchReplaceCollection {
    pub id: String,
    pub name: String,
    pub rules: Vec<MatchReplaceRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchReplaceData {
    pub collections: Vec<MatchReplaceCollection>,
}
