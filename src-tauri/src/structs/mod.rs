use serde::{Deserialize, Serialize};

// export type PayloadSource =
//   | 'library' // Predefined payload library
//   | 'file'
//   | 'generator'
//   | 'manual';

#[derive(Debug)]
pub enum PayloadSource {
    Library,
    File,
    Generator,
    Manual,
}

impl PayloadSource {
    fn get_value(&self) -> &'static str {
        match self {
            PayloadSource::Library => "library",
            PayloadSource::File => "file",
            PayloadSource::Generator => "generator",
            PayloadSource::Manual => "manual",
        }
    }
    fn from_str(input: &str) -> Option<PayloadSource> {
        match input.to_lowercase().as_str() {
            "library" => Some(PayloadSource::Library),
            "file" => Some(PayloadSource::File),
            "generator" => Some(PayloadSource::Generator),
            "manual" => Some(PayloadSource::Manual),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuzzerMetadata {
    #[serde(rename = "targetUrl")]
    pub target_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuzzerParameter {
    pub name: String,
    #[serde(rename = "replacedValue")]
    pub replaced_value: String,
    pub values: Vec<String>,
    #[serde(rename = "payloadSource")]
    pub payload_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuzzerPayload {
    #[serde(rename = "rawRequest")]
    pub raw_request: String, 
    pub metadata: FuzzerMetadata,
    pub parameters: Vec<FuzzerParameter>,
}
