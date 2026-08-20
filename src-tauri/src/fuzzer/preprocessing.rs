use base64::Engine;
use regex::Regex;
use crate::types::{FuzzerParameter, FuzzerSession, PreprocessingRule};

/// Determines which preprocessing rules apply to a given parameter based on pipeline scope.
pub fn get_active_rules<'a>(
    session: &'a FuzzerSession,
    param: &'a FuzzerParameter,
) -> &'a [PreprocessingRule] {
    let scope = session
        .fuzz_config
        .pipeline_scope
        .as_deref()
        .unwrap_or("all");

    if scope == "per_parameter" {
        param.pipeline_rules.as_deref().unwrap_or(&[])
    } else {
        session.fuzz_config.pipeline_rules.as_deref().unwrap_or(&[])
    }
}

/// Applies a sequence of preprocessing rules sequentially to an input payload string.
pub fn apply_pipeline(input: &str, rules: &[PreprocessingRule]) -> String {
    let mut current = input.to_string();
    for rule in rules {
        current = apply_rule(&current, rule);
    }
    current
}

/// Applies a single preprocessing rule to a payload string.
pub fn apply_rule(input: &str, rule: &PreprocessingRule) -> String {
    match rule.rule_type.as_str() {
        "modify_case" => match rule.case_option.as_deref() {
            Some("lowercase") => input.to_lowercase(),
            Some("uppercase") => input.to_uppercase(),
            _ => input.to_string(),
        },
        "encode" => match rule.encode_option.as_deref() {
            Some("url_key") => encode_url_key_characters(input),
            Some("url_all") => encode_url_all_characters(input),
            Some("base64") => {
                base64::engine::general_purpose::STANDARD.encode(input.as_bytes())
            }
            _ => input.to_string(),
        },
        "decode" => match rule.decode_option.as_deref() {
            Some("url") | Some("url_key") | Some("url_all") => decode_url(input),
            Some("base64") => {
                let trimmed = input.trim();
                match base64::engine::general_purpose::STANDARD.decode(trimmed.as_bytes()) {
                    Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                    Err(_) => input.to_string(),
                }
            }
            _ => input.to_string(),
        },
        "prefix" => {
            let prefix = rule.value.as_deref().unwrap_or("");
            format!("{}{}", prefix, input)
        }
        "suffix" => {
            let suffix = rule.value.as_deref().unwrap_or("");
            format!("{}{}", input, suffix)
        }
        "match_replace" => {
            let pattern_str = rule.pattern.as_deref().unwrap_or("");
            let replacement = rule.replacement.as_deref().unwrap_or("");
            if pattern_str.is_empty() {
                input.to_string()
            } else {
                match Regex::new(pattern_str) {
                    Ok(re) => re.replace_all(input, replacement).to_string(),
                    Err(_) => input.replace(pattern_str, replacement),
                }
            }
        }
        _ => input.to_string(),
    }
}

/// URL-encodes key/reserved characters (characters other than unreserved A-Z, a-z, 0-9, -, _, ., ~).
pub fn encode_url_key_characters(input: &str) -> String {
    let mut result = String::with_capacity(input.len() * 3);
    for b in input.as_bytes() {
        match *b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(*b as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", b));
            }
        }
    }
    result
}

/// URL-encodes every character into %XX format.
pub fn encode_url_all_characters(input: &str) -> String {
    let mut result = String::with_capacity(input.len() * 3);
    for b in input.as_bytes() {
        result.push_str(&format!("%{:02X}", b));
    }
    result
}

/// Decodes percent-encoded %XX sequences.
pub fn decode_url(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let input_bytes = input.as_bytes();
    let mut i = 0;
    while i < input_bytes.len() {
        if input_bytes[i] == b'%' && i + 2 < input_bytes.len() {
            let hex_str = match std::str::from_utf8(&input_bytes[i + 1..i + 3]) {
                Ok(s) => s,
                Err(_) => {
                    bytes.push(input_bytes[i]);
                    i += 1;
                    continue;
                }
            };
            if let Ok(val) = u8::from_str_radix(hex_str, 16) {
                bytes.push(val);
                i += 3;
                continue;
            }
        }
        bytes.push(input_bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&bytes).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_modify_case() {
        let rule_lower = PreprocessingRule {
            id: "1".into(),
            rule_type: "modify_case".into(),
            case_option: Some("lowercase".into()),
            encode_option: None,
            decode_option: None,
            value: None,
            pattern: None,
            replacement: None,
            is_regex: None,
        };
        assert_eq!(apply_rule("HeLLo WoRLd", &rule_lower), "hello world");

        let rule_upper = PreprocessingRule {
            id: "2".into(),
            rule_type: "modify_case".into(),
            case_option: Some("uppercase".into()),
            encode_option: None,
            decode_option: None,
            value: None,
            pattern: None,
            replacement: None,
            is_regex: None,
        };
        assert_eq!(apply_rule("hello world", &rule_upper), "HELLO WORLD");
    }

    #[test]
    fn test_encoding_decoding() {
        let rule_url_key = PreprocessingRule {
            id: "1".into(),
            rule_type: "encode".into(),
            case_option: None,
            encode_option: Some("url_key".into()),
            decode_option: None,
            value: None,
            pattern: None,
            replacement: None,
            is_regex: None,
        };
        assert_eq!(apply_rule("hello world&foo=bar", &rule_url_key), "hello%20world%26foo%3Dbar");

        let rule_url_all = PreprocessingRule {
            id: "2".into(),
            rule_type: "encode".into(),
            case_option: None,
            encode_option: Some("url_all".into()),
            decode_option: None,
            value: None,
            pattern: None,
            replacement: None,
            is_regex: None,
        };
        assert_eq!(apply_rule("abc", &rule_url_all), "%61%62%63");

        let rule_url_dec = PreprocessingRule {
            id: "3".into(),
            rule_type: "decode".into(),
            case_option: None,
            encode_option: None,
            decode_option: Some("url".into()),
            value: None,
            pattern: None,
            replacement: None,
            is_regex: None,
        };
        assert_eq!(apply_rule("hello%20world%26foo%3Dbar", &rule_url_dec), "hello world&foo=bar");

        let rule_b64_enc = PreprocessingRule {
            id: "4".into(),
            rule_type: "encode".into(),
            case_option: None,
            encode_option: Some("base64".into()),
            decode_option: None,
            value: None,
            pattern: None,
            replacement: None,
            is_regex: None,
        };
        assert_eq!(apply_rule("admin", &rule_b64_enc), "YWRtaW4=");

        let rule_b64_dec = PreprocessingRule {
            id: "5".into(),
            rule_type: "decode".into(),
            case_option: None,
            encode_option: None,
            decode_option: Some("base64".into()),
            value: None,
            pattern: None,
            replacement: None,
            is_regex: None,
        };
        assert_eq!(apply_rule("YWRtaW4=", &rule_b64_dec), "admin");
    }

    #[test]
    fn test_prefix_suffix_replace() {
        let rule_prefix = PreprocessingRule {
            id: "1".into(),
            rule_type: "prefix".into(),
            case_option: None,
            encode_option: None,
            decode_option: None,
            value: Some("pre_".into()),
            pattern: None,
            replacement: None,
            is_regex: None,
        };
        assert_eq!(apply_rule("payload", &rule_prefix), "pre_payload");

        let rule_suffix = PreprocessingRule {
            id: "2".into(),
            rule_type: "suffix".into(),
            case_option: None,
            encode_option: None,
            decode_option: None,
            value: Some("_suf".into()),
            pattern: None,
            replacement: None,
            is_regex: None,
        };
        assert_eq!(apply_rule("payload", &rule_suffix), "payload_suf");

        let rule_match = PreprocessingRule {
            id: "3".into(),
            rule_type: "match_replace".into(),
            case_option: None,
            encode_option: None,
            decode_option: None,
            value: None,
            pattern: Some(r"\d+".into()),
            replacement: Some("NUM".into()),
            is_regex: Some(true),
        };
        assert_eq!(apply_rule("user123test456", &rule_match), "userNUMtestNUM");
    }
}
