use crate::types::HighlightRange;

pub fn building_raw_request(
    raw_request: &str,
    param_value: &str,
    highlight_range: &HighlightRange,
) -> String {
    let from = highlight_range.from as usize;
    let to = highlight_range.to as usize;

    // Build the new request by concatenating:
    // 1. Everything before 'from'
    // 2. The param_value
    // 3. Everything after 'to'
    let mut result = String::new();
    result.push_str(&raw_request[..from]);
    result.push_str(param_value);
    result.push_str(&raw_request[to..]);

    result
}
