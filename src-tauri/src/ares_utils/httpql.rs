use chrono::{DateTime, NaiveDate, NaiveDateTime};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use crate::ares_utils::parse::split_message;

pub fn parse_datetime_to_ms(s: &str) -> Option<i64> {
    let trimmed = s.trim().trim_matches(|c| c == '"' || c == '\'');
    if let Ok(num) = trimmed.parse::<i64>() {
        if num < 100_000_000_000 {
            return Some(num * 1000);
        }
        return Some(num);
    }
    // 1. RFC3339 / ISO8601 (e.g. 2026-08-21T01:30:00Z)
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Some(dt.timestamp_millis());
    }
    // 2. RFC2822 / RFC7231 (e.g. Fri, 21 Aug 2026 01:30:00 GMT)
    if let Ok(dt) = DateTime::parse_from_rfc2822(trimmed) {
        return Some(dt.timestamp_millis());
    }
    // 3. ISO9075 / Naive format (e.g. 2026-08-21 01:30:00)
    if let Ok(ndt) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S") {
        return Some(ndt.and_utc().timestamp_millis());
    }
    // 4. Date only (e.g. 2026-08-21)
    if let Ok(nd) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        if let Some(ndt) = nd.and_hms_opt(0, 0, 0) {
            return Some(ndt.and_utc().timestamp_millis());
        }
    }
    None
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum HttpqlField {
    // Request fields
    ReqId,
    ReqCreatedAt,
    ReqMethod,
    ReqHost,
    ReqPath,
    ReqQuery,
    ReqExt,
    ReqPort,
    ReqTls,
    ReqRaw,
    ReqBody,
    ReqHeader(Option<String>),
    ReqLen,

    // Response fields
    RespCode,
    RespTime,
    RespLen,
    RespRaw,
    RespBody,
    RespHeader(Option<String>),
    RespExt,
    RespState,

    // Generic / Caido extensions
    Preset,
    Bare,
    Payload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HttpqlOperator {
    Eq,
    Ne,
    Cont,
    Ncont,
    Sw,
    Nsw,
    Ew,
    New,
    Like,
    Nlike,
    Regex,
    Nregex,
    Gt,
    Ge,
    Lt,
    Le,
    In,
    Nin,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum HttpqlValue {
    String(String),
    Number(i64),
    Bool(bool),
    List(Vec<String>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpqlCondition {
    pub field: HttpqlField,
    pub op: HttpqlOperator,
    pub value: HttpqlValue,
    #[serde(skip)]
    pub compiled_regex: Option<Arc<Regex>>,
}

impl PartialEq for HttpqlCondition {
    fn eq(&self, other: &Self) -> bool {
        self.field == other.field && self.op == other.op && self.value == other.value
    }
}

impl HttpqlCondition {
    pub fn new(field: HttpqlField, op: HttpqlOperator, value: HttpqlValue) -> Self {
        let mut cond = Self {
            field,
            op,
            value,
            compiled_regex: None,
        };
        cond.compile_regex();
        cond
    }

    pub fn compile_regex(&mut self) {
        match self.op {
            HttpqlOperator::Regex | HttpqlOperator::Nregex => {
                let exp_str = val_as_string(&self.value);
                if let Ok(re) = Regex::new(&exp_str) {
                    self.compiled_regex = Some(Arc::new(re));
                }
            }
            HttpqlOperator::Like | HttpqlOperator::Nlike => {
                let pattern = val_as_string(&self.value);
                if let Ok(re) = sql_like_to_regex(&pattern) {
                    self.compiled_regex = Some(Arc::new(re));
                }
            }
            _ => {
                self.compiled_regex = None;
            }
        }
    }

    pub fn is_exact_column(&self) -> bool {
        match self.field {
            HttpqlField::RespCode
            | HttpqlField::RespLen
            | HttpqlField::RespTime
            | HttpqlField::ReqId
            | HttpqlField::Payload
            | HttpqlField::ReqCreatedAt => {
                !matches!(self.op, HttpqlOperator::Regex | HttpqlOperator::Nregex)
            }
            _ => false,
        }
    }

    pub fn is_fts_chunk_match(&self) -> bool {
        match self.field {
            HttpqlField::RespHeader(_) | HttpqlField::RespRaw | HttpqlField::RespBody => {
                let term = val_as_string(&self.value);
                term.trim().len() >= 3
                    && matches!(
                        self.op,
                        HttpqlOperator::Cont | HttpqlOperator::Eq | HttpqlOperator::Like
                    )
            }
            _ => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum HttpqlExpr {
    Condition(HttpqlCondition),
    Bare(String),
    Not(Box<HttpqlExpr>),
    And(Vec<HttpqlExpr>),
    Or(Vec<HttpqlExpr>),
}

// -----------------------------------------------------------------------------
// Lexer / Tokenizer
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    // Key with optional header bracket and optional operator modifier: e.g. "req.method.eq", "req.header[\"content-type\"].cont"
    FieldOp {
        field_str: String,
        header_key: Option<String>,
        op_str: Option<String>,
    },
    Colon,
    StringVal(String),
    NumberVal(i64),
    BoolVal(bool),
    ListVal(Vec<String>),
    And,
    Or,
    Not,
    LParen,
    RParen,
    BareWord(String),
}

pub struct Lexer<'a> {
    input: &'a str,
    chars: Vec<char>,
    pos: usize,
}

impl<'a> Lexer<'a> {
    pub fn new(input: &'a str) -> Self {
        Self {
            input,
            chars: input.chars().collect(),
            pos: 0,
        }
    }

    fn peek(&self) -> Option<char> {
        if self.pos < self.chars.len() {
            Some(self.chars[self.pos])
        } else {
            None
        }
    }

    fn advance(&mut self) -> Option<char> {
        if self.pos < self.chars.len() {
            let ch = self.chars[self.pos];
            self.pos += 1;
            Some(ch)
        } else {
            None
        }
    }

    fn skip_whitespace(&mut self) {
        while let Some(ch) = self.peek() {
            if ch.is_whitespace() {
                self.advance();
            } else {
                break;
            }
        }
    }

    pub fn tokenize(&mut self) -> Result<Vec<Token>, String> {
        let mut tokens = Vec::new();

        while self.pos < self.chars.len() {
            self.skip_whitespace();
            if self.pos >= self.chars.len() {
                break;
            }

            let ch = self.chars[self.pos];

            // Single-line comment: // or #
            if ch == '#' || (ch == '/' && self.pos + 1 < self.chars.len() && self.chars[self.pos + 1] == '/') {
                while let Some(c) = self.advance() {
                    if c == '\n' {
                        break;
                    }
                }
                continue;
            }

            // Multi-line comment: /* ... */
            if ch == '/' && self.pos + 1 < self.chars.len() && self.chars[self.pos + 1] == '*' {
                self.pos += 2;
                while self.pos < self.chars.len() {
                    if self.chars[self.pos] == '*' && self.pos + 1 < self.chars.len() && self.chars[self.pos + 1] == '/' {
                        self.pos += 2;
                        break;
                    }
                    self.pos += 1;
                }
                continue;
            }

            if ch == '(' {
                self.advance();
                tokens.push(Token::LParen);
                continue;
            }

            if ch == ')' {
                self.advance();
                tokens.push(Token::RParen);
                continue;
            }

            if ch == '!' {
                self.advance();
                tokens.push(Token::Not);
                continue;
            }

            if ch == '&' && self.pos + 1 < self.chars.len() && self.chars[self.pos + 1] == '&' {
                self.pos += 2;
                tokens.push(Token::And);
                continue;
            }

            if ch == '|' && self.pos + 1 < self.chars.len() && self.chars[self.pos + 1] == '|' {
                self.pos += 2;
                tokens.push(Token::Or);
                continue;
            }

            // Quoted string (e.g. "foo bar" or 'foo bar')
            if ch == '"' || ch == '\'' {
                let quote = ch;
                self.advance();
                let mut s = String::new();
                let mut escaped = false;
                while let Some(c) = self.advance() {
                    if escaped {
                        s.push(c);
                        escaped = false;
                    } else if c == '\\' {
                        escaped = true;
                    } else if c == quote {
                        break;
                    } else {
                        s.push(c);
                    }
                }
                tokens.push(Token::StringVal(s));
                continue;
            }

            // Check for list literal e.g. ["a", "b", 200]
            if ch == '[' {
                let list = self.read_list()?;
                tokens.push(Token::ListVal(list));
                continue;
            }

            // Read an identifier / word or field expression
            let word = self.read_word();
            if word.is_empty() {
                self.advance();
                continue;
            }

            let word_lower = word.to_lowercase();
            if word_lower == "and" {
                tokens.push(Token::And);
                continue;
            }
            if word_lower == "or" {
                tokens.push(Token::Or);
                continue;
            }
            if word_lower == "not" {
                tokens.push(Token::Not);
                continue;
            }

            if word == ":" {
                tokens.push(Token::Colon);
                continue;
            }

            // Check if word contains a colon `:`
            // Examples:
            // req.method:"GET"
            // req.header["user-agent"].cont:"firefox"
            // resp.code:200
            // resp.code.ge:400
            if let Some(colon_idx) = word.find(':') {
                if colon_idx > 0 {
                    let left_part = &word[..colon_idx];
                    let right_part = &word[colon_idx + 1..];

                    let (field_str, header_key, op_str) = parse_field_with_modifiers(left_part);

                    tokens.push(Token::FieldOp {
                        field_str,
                        header_key,
                        op_str,
                    });
                    tokens.push(Token::Colon);

                    if !right_part.is_empty() {
                        // Right part immediately attached (e.g. `resp.code:200` or `req.path.sw:/api`)
                        if right_part.starts_with('[') && right_part.ends_with(']') {
                            let inner = &right_part[1..right_part.len() - 1];
                            let items = parse_comma_items(inner);
                            tokens.push(Token::ListVal(items));
                        } else if right_part.eq_ignore_ascii_case("true") {
                            tokens.push(Token::BoolVal(true));
                        } else if right_part.eq_ignore_ascii_case("false") {
                            tokens.push(Token::BoolVal(false));
                        } else if let Ok(num) = right_part.parse::<i64>() {
                            tokens.push(Token::NumberVal(num));
                        } else {
                            let cleaned = right_part.trim_matches(|c| c == '"' || c == '\'');
                            tokens.push(Token::StringVal(cleaned.to_string()));
                        }
                    }
                    continue;
                } else {
                    tokens.push(Token::Colon);
                    let right_part = &word[1..];
                    if !right_part.is_empty() {
                        if right_part.eq_ignore_ascii_case("true") {
                            tokens.push(Token::BoolVal(true));
                        } else if right_part.eq_ignore_ascii_case("false") {
                            tokens.push(Token::BoolVal(false));
                        } else if let Ok(num) = right_part.parse::<i64>() {
                            tokens.push(Token::NumberVal(num));
                        } else {
                            let cleaned = right_part.trim_matches(|c| c == '"' || c == '\'');
                            tokens.push(Token::StringVal(cleaned.to_string()));
                        }
                    }
                    continue;
                }
            }

            // Check if this is a field without immediate colon (e.g. `req.method : "GET"`)
            if is_known_field_prefix(&word) {
                let (field_str, header_key, op_str) = parse_field_with_modifiers(&word);
                tokens.push(Token::FieldOp {
                    field_str,
                    header_key,
                    op_str,
                });
                continue;
            }

            // Standalone number, bool, or bare term
            if word.eq_ignore_ascii_case("true") {
                tokens.push(Token::BoolVal(true));
            } else if word.eq_ignore_ascii_case("false") {
                tokens.push(Token::BoolVal(false));
            } else if let Ok(num) = word.parse::<i64>() {
                tokens.push(Token::NumberVal(num));
            } else {
                tokens.push(Token::BareWord(word));
            }
        }

        Ok(tokens)
    }

    fn read_word(&mut self) -> String {
        let mut s = String::new();
        let mut in_bracket = false;
        let mut in_quotes = false;
        let mut quote_char = '"';

        while let Some(ch) = self.peek() {
            if in_quotes {
                s.push(ch);
                self.advance();
                if ch == quote_char {
                    in_quotes = false;
                }
                continue;
            }

            if ch == '"' || ch == '\'' {
                in_quotes = true;
                quote_char = ch;
                s.push(ch);
                self.advance();
                continue;
            }

            if ch == '[' {
                in_bracket = true;
                s.push(ch);
                self.advance();
                continue;
            }

            if ch == ']' {
                in_bracket = false;
                s.push(ch);
                self.advance();
                continue;
            }

            if in_bracket {
                s.push(ch);
                self.advance();
                continue;
            }

            if ch.is_whitespace() || ch == '(' || ch == ')' {
                break;
            }

            s.push(ch);
            self.advance();
        }
        s
    }

    fn read_list(&mut self) -> Result<Vec<String>, String> {
        self.advance(); // skip '['
        let mut content = String::new();
        let mut in_quotes = false;
        let mut quote_char = '"';

        while let Some(ch) = self.advance() {
            if in_quotes {
                if ch == quote_char {
                    in_quotes = false;
                }
                content.push(ch);
            } else {
                if ch == '"' || ch == '\'' {
                    in_quotes = true;
                    quote_char = ch;
                    content.push(ch);
                } else if ch == ']' {
                    return Ok(parse_comma_items(&content));
                } else {
                    content.push(ch);
                }
            }
        }

        Ok(parse_comma_items(&content))
    }
}

fn parse_comma_items(input: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut quote_char = '"';

    for ch in input.chars() {
        if in_quotes {
            if ch == quote_char {
                in_quotes = false;
            } else {
                cur.push(ch);
            }
        } else if ch == '"' || ch == '\'' {
            in_quotes = true;
            quote_char = ch;
        } else if ch == ',' {
            let trimmed = cur.trim().to_string();
            if !trimmed.is_empty() {
                items.push(trimmed);
            }
            cur.clear();
        } else {
            cur.push(ch);
        }
    }
    let trimmed = cur.trim().to_string();
    if !trimmed.is_empty() {
        items.push(trimmed);
    }
    items
}

fn is_known_field_prefix(word: &str) -> bool {
    let lower = word.to_lowercase();
    lower.starts_with("req.")
        || lower.starts_with("resp.")
        || lower.starts_with("row.")
        || lower.starts_with("preset")
        || lower.starts_with("method")
        || lower.starts_with("host")
        || lower.starts_with("path")
        || lower.starts_with("query")
        || lower.starts_with("ext")
        || lower.starts_with("status")
        || lower.starts_with("code")
        || lower.starts_with("duration")
        || lower.starts_with("roundtrip")
        || lower.starts_with("time")
        || lower.starts_with("len")
        || lower.starts_with("id")
        || lower.starts_with("created_at")
        || lower.starts_with("state")
}

fn parse_field_with_modifiers(input: &str) -> (String, Option<String>, Option<String>) {
    let mut header_key = None;
    let mut base = input.to_string();

    // Check if bracket is present e.g. req.header["authorization"].cont
    if let Some(b_start) = input.find('[') {
        if let Some(b_end) = input.find(']') {
            let key = &input[b_start + 1..b_end];
            let clean_key = key.trim_matches(|c| c == '"' || c == '\'');
            header_key = Some(clean_key.to_string());
            base = format!("{}{}", &input[..b_start], &input[b_end + 1..]);
        }
    }

    // Now look for modifier e.g. "req.path.cont" -> field "req.path", op "cont"
    let parts: Vec<&str> = base.split('.').collect();
    if parts.len() >= 2 {
        let last = parts.last().unwrap().to_lowercase();
        if is_known_operator(&last) {
            let field_part = parts[..parts.len() - 1].join(".");
            return (field_part, header_key, Some(last));
        }
    }

    (base, header_key, None)
}

fn is_known_operator(op: &str) -> bool {
    matches!(
        op,
        "eq" | "ne"
            | "cont"
            | "ncont"
            | "sw"
            | "nsw"
            | "ew"
            | "new"
            | "like"
            | "nlike"
            | "regex"
            | "regix"
            | "nregex"
            | "nregix"
            | "gt"
            | "ge"
            | "gte"
            | "lt"
            | "le"
            | "lte"
            | "in"
            | "nin"
    )
}

// -----------------------------------------------------------------------------
// Parser
// -----------------------------------------------------------------------------

pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, pos: 0 }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn advance(&mut self) -> Option<Token> {
        if self.pos < self.tokens.len() {
            let tok = self.tokens[self.pos].clone();
            self.pos += 1;
            Some(tok)
        } else {
            None
        }
    }

    pub fn parse(&mut self) -> Result<Option<HttpqlExpr>, String> {
        if self.tokens.is_empty() {
            return Ok(None);
        }
        let expr = self.parse_or()?;
        Ok(Some(expr))
    }

    // OR expression
    fn parse_or(&mut self) -> Result<HttpqlExpr, String> {
        let mut left = self.parse_and()?;

        while let Some(Token::Or) = self.peek() {
            self.advance();
            let right = self.parse_and()?;
            match left {
                HttpqlExpr::Or(mut list) => {
                    list.push(right);
                    left = HttpqlExpr::Or(list);
                }
                _ => {
                    left = HttpqlExpr::Or(vec![left, right]);
                }
            }
        }

        Ok(left)
    }

    // AND expression (both explicit `and` / `&&` and implicit juxtaposition)
    fn parse_and(&mut self) -> Result<HttpqlExpr, String> {
        let mut left = self.parse_not()?;

        while let Some(tok) = self.peek() {
            if *tok == Token::Or || *tok == Token::RParen {
                break;
            }

            if *tok == Token::And {
                self.advance();
            }

            let right = self.parse_not()?;
            match left {
                HttpqlExpr::And(mut list) => {
                    list.push(right);
                    left = HttpqlExpr::And(list);
                }
                _ => {
                    left = HttpqlExpr::And(vec![left, right]);
                }
            }
        }

        Ok(left)
    }

    // NOT expression
    fn parse_not(&mut self) -> Result<HttpqlExpr, String> {
        if let Some(Token::Not) = self.peek() {
            self.advance();
            let operand = self.parse_not()?;
            return Ok(HttpqlExpr::Not(Box::new(operand)));
        }

        self.parse_primary()
    }

    // Primary expression: (expr), FieldOp : Value, or Bare word
    fn parse_primary(&mut self) -> Result<HttpqlExpr, String> {
        let tok = self
            .advance()
            .ok_or_else(|| "Unexpected end of input".to_string())?;

        match tok {
            Token::LParen => {
                let inner = self.parse_or()?;
                match self.advance() {
                    Some(Token::RParen) => Ok(inner),
                    _ => Err("Missing closing parenthesis ')'".to_string()),
                }
            }
            Token::FieldOp {
                field_str,
                header_key,
                op_str,
            } => {
                // If next token is colon, consume it
                if let Some(Token::Colon) = self.peek() {
                    self.advance();
                }

                let value_tok = self
                    .advance()
                    .ok_or_else(|| format!("Expected value after field '{}'", field_str))?;

                let value = match value_tok {
                    Token::StringVal(s) => HttpqlValue::String(s),
                    Token::NumberVal(n) => HttpqlValue::Number(n),
                    Token::BoolVal(b) => HttpqlValue::Bool(b),
                    Token::ListVal(l) => HttpqlValue::List(l),
                    Token::BareWord(s) => HttpqlValue::String(s),
                    other => {
                        return Err(format!("Unexpected value token: {:?}", other));
                    }
                };

                let field = parse_field_type(&field_str, header_key)?;
                let op = parse_operator(op_str.as_deref(), &value);

                Ok(HttpqlExpr::Condition(HttpqlCondition::new(field, op, value)))
            }
            Token::BareWord(s) => {
                if let Some(Token::Colon) = self.peek() {
                    self.advance(); // consume colon
                    let value_tok = self
                        .advance()
                        .ok_or_else(|| format!("Expected value after field '{}'", s))?;
                    let value = match value_tok {
                        Token::StringVal(v) => HttpqlValue::String(v),
                        Token::NumberVal(n) => HttpqlValue::Number(n),
                        Token::BoolVal(b) => HttpqlValue::Bool(b),
                        Token::ListVal(l) => HttpqlValue::List(l),
                        Token::BareWord(v) => HttpqlValue::String(v),
                        other => {
                            return Err(format!("Unexpected value token after colon: {:?}", other));
                        }
                    };
                    let (field_str, header_key, op_str) = parse_field_with_modifiers(&s);
                    let field = parse_field_type(&field_str, header_key)?;
                    let op = parse_operator(op_str.as_deref(), &value);
                    Ok(HttpqlExpr::Condition(HttpqlCondition::new(field, op, value)))
                } else {
                    Ok(HttpqlExpr::Bare(s))
                }
            }
            Token::StringVal(s) => Ok(HttpqlExpr::Bare(s)),
            Token::NumberVal(n) => Ok(HttpqlExpr::Bare(n.to_string())),
            Token::Colon => Err("Unexpected standalone ':'".to_string()),
            other => Err(format!("Unexpected token: {:?}", other)),
        }
    }
}

fn parse_field_type(field_str: &str, header_key: Option<String>) -> Result<HttpqlField, String> {
    let lower = field_str.to_lowercase();
    match lower.as_str() {
        "row.id" | "row" | "req.id" | "id" => Ok(HttpqlField::ReqId),
        "req.created_at" | "created_at" => Ok(HttpqlField::ReqCreatedAt),
        "req.method" | "method" => Ok(HttpqlField::ReqMethod),
        "req.host" | "host" => Ok(HttpqlField::ReqHost),
        "req.path" | "path" => Ok(HttpqlField::ReqPath),
        "req.query" | "query" => Ok(HttpqlField::ReqQuery),
        "req.ext" | "req.extension" | "ext" => Ok(HttpqlField::ReqExt),
        "req.port" | "port" => Ok(HttpqlField::ReqPort),
        "req.tls" | "req.scheme" | "req.https" | "is_https" | "https" => Ok(HttpqlField::ReqTls),
        "req.raw" => Ok(HttpqlField::ReqRaw),
        "req.body" => Ok(HttpqlField::ReqBody),
        "req.header" | "req.headers" | "req.header.name" | "req.header.value" => {
            Ok(HttpqlField::ReqHeader(header_key))
        }
        "req.len" | "req.length" => Ok(HttpqlField::ReqLen),

        "resp.code" | "resp.status" | "status" | "code" | "status_code" => Ok(HttpqlField::RespCode),
        "resp.roundtrip" | "roundtrip" | "resp.time" | "resp.duration" | "time" | "duration" => {
            Ok(HttpqlField::RespTime)
        }
        "resp.len" | "resp.length" | "resp.size" | "len" | "length" => Ok(HttpqlField::RespLen),
        "resp.raw" => Ok(HttpqlField::RespRaw),
        "resp.body" => Ok(HttpqlField::RespBody),
        "resp.header" | "resp.headers" | "resp.header.name" | "resp.header.value" => {
            Ok(HttpqlField::RespHeader(header_key))
        }
        "resp.ext" => Ok(HttpqlField::RespExt),
        "state" | "resp.state" | "status_text" => Ok(HttpqlField::RespState),
        "preset" => Ok(HttpqlField::Preset),
        "payload" | "payloadpreview" | "fuzz.payload" => Ok(HttpqlField::Payload),
        _ => {
            if lower.starts_with("req.header") {
                Ok(HttpqlField::ReqHeader(header_key))
            } else if lower.starts_with("resp.header") {
                Ok(HttpqlField::RespHeader(header_key))
            } else {
                Err(format!("Unknown HTTPQL field: '{}'", field_str))
            }
        }
    }
}

fn parse_operator(op_str: Option<&str>, value: &HttpqlValue) -> HttpqlOperator {
    if let Some(op) = op_str {
        match op.to_lowercase().as_str() {
            "eq" => HttpqlOperator::Eq,
            "ne" => HttpqlOperator::Ne,
            "cont" => HttpqlOperator::Cont,
            "ncont" => HttpqlOperator::Ncont,
            "sw" => HttpqlOperator::Sw,
            "nsw" => HttpqlOperator::Nsw,
            "ew" => HttpqlOperator::Ew,
            "new" => HttpqlOperator::New,
            "like" => HttpqlOperator::Like,
            "nlike" => HttpqlOperator::Nlike,
            "regex" | "regix" => HttpqlOperator::Regex,
            "nregex" | "nregix" => HttpqlOperator::Nregex,
            "gt" => HttpqlOperator::Gt,
            "ge" | "gte" => HttpqlOperator::Ge,
            "lt" => HttpqlOperator::Lt,
            "le" | "lte" => HttpqlOperator::Le,
            "in" => HttpqlOperator::In,
            "nin" => HttpqlOperator::Nin,
            _ => HttpqlOperator::Eq,
        }
    } else {
        match value {
            HttpqlValue::List(_) => HttpqlOperator::In,
            _ => HttpqlOperator::Eq,
        }
    }
}

// -----------------------------------------------------------------------------
// Top-Level Parse API
// -----------------------------------------------------------------------------

pub fn parse_httpql(input: &str) -> Result<Option<HttpqlExpr>, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let mut lexer = Lexer::new(trimmed);
    let tokens = lexer.tokenize()?;
    let mut parser = Parser::new(tokens);
    let expr = parser.parse()?;
    Ok(expr.map(|e| {
        let mut simplified = e.simplify();
        simplified.compile_regexes();
        simplified
    }))
}

pub fn expand_presets_in_expr(
    expr: HttpqlExpr,
    presets: &HashMap<String, String>,
) -> HttpqlExpr {
    let mut visited = HashSet::new();
    expand_presets_recursive(expr, presets, &mut visited, 0)
}

fn expand_presets_recursive(
    expr: HttpqlExpr,
    presets: &HashMap<String, String>,
    visited: &mut HashSet<String>,
    depth: usize,
) -> HttpqlExpr {
    if depth > 15 {
        return expr;
    }
    match expr {
        HttpqlExpr::Condition(cond) => {
            if cond.field == HttpqlField::Preset {
                let val_str = val_as_string(&cond.value).to_lowercase();
                let preset_name = val_str.replace('_', "-");
                let preset_alias = preset_name.trim_matches(|c| c == '"' || c == '\'').to_string();

                if !visited.contains(&preset_alias) {
                    if let Some(target_expr_str) = presets.get(&preset_alias) {
                        visited.insert(preset_alias.clone());
                        if let Ok(Some(parsed_sub)) = parse_httpql(target_expr_str) {
                            let expanded = expand_presets_recursive(parsed_sub, presets, visited, depth + 1);
                            visited.remove(&preset_alias);
                            return expanded;
                        }
                        visited.remove(&preset_alias);
                    }
                }
            }
            HttpqlExpr::Condition(cond)
        }
        HttpqlExpr::Not(inner) => {
            HttpqlExpr::Not(Box::new(expand_presets_recursive(*inner, presets, visited, depth + 1)))
        }
        HttpqlExpr::And(list) => {
            HttpqlExpr::And(list.into_iter().map(|e| expand_presets_recursive(e, presets, visited, depth)).collect())
        }
        HttpqlExpr::Or(list) => {
            HttpqlExpr::Or(list.into_iter().map(|e| expand_presets_recursive(e, presets, visited, depth)).collect())
        }
        other => other,
    }
}

pub fn parse_httpql_with_presets(
    input: &str,
    presets: &HashMap<String, String>,
) -> Result<Option<HttpqlExpr>, String> {
    let parsed = parse_httpql(input)?;
    Ok(parsed.map(|expr| expand_presets_in_expr(expr, presets)))
}

// -----------------------------------------------------------------------------
// SQL Compiler for sqlx::QueryBuilder
// -----------------------------------------------------------------------------

impl HttpqlExpr {
    pub fn has_regex(&self) -> bool {
        match self {
            HttpqlExpr::Condition(cond) => {
                matches!(cond.op, HttpqlOperator::Regex | HttpqlOperator::Nregex)
            }
            HttpqlExpr::Not(inner) => inner.has_regex(),
            HttpqlExpr::And(list) | HttpqlExpr::Or(list) => {
                list.iter().any(|item| item.has_regex())
            }
            HttpqlExpr::Bare(_) => false,
        }
    }

    pub fn compile_regexes(&mut self) {
        match self {
            HttpqlExpr::Condition(cond) => {
                cond.compile_regex();
            }
            HttpqlExpr::Not(inner) => {
                inner.compile_regexes();
            }
            HttpqlExpr::And(list) | HttpqlExpr::Or(list) => {
                for item in list {
                    item.compile_regexes();
                }
            }
            HttpqlExpr::Bare(_) => {}
        }
    }

    pub fn simplify(self) -> Self {
        match self {
            HttpqlExpr::Not(inner) => {
                let inner = inner.simplify();
                match inner {
                    HttpqlExpr::Not(double_inner) => *double_inner,
                    other => HttpqlExpr::Not(Box::new(other)),
                }
            }
            HttpqlExpr::And(items) => {
                let mut flat = Vec::new();
                for item in items {
                    let simplified = item.simplify();
                    match simplified {
                        HttpqlExpr::And(nested) => flat.extend(nested),
                        other => flat.push(other),
                    }
                }
                if flat.len() == 1 {
                    flat.into_iter().next().unwrap()
                } else {
                    HttpqlExpr::And(flat)
                }
            }
            HttpqlExpr::Or(items) => {
                let mut flat = Vec::new();
                for item in items {
                    let simplified = item.simplify();
                    match simplified {
                        HttpqlExpr::Or(nested) => flat.extend(nested),
                        other => flat.push(other),
                    }
                }
                if flat.len() == 1 {
                    flat.into_iter().next().unwrap()
                } else {
                    HttpqlExpr::Or(flat)
                }
            }
            other => other,
        }
    }

    pub fn predicate_cost(&self) -> u32 {
        match self {
            HttpqlExpr::Condition(cond) => {
                let base = match cond.field {
                    HttpqlField::RespCode
                    | HttpqlField::RespLen
                    | HttpqlField::RespTime
                    | HttpqlField::ReqId
                    | HttpqlField::ReqLen
                    | HttpqlField::ReqCreatedAt
                    | HttpqlField::ReqPort
                    | HttpqlField::ReqTls => 1,

                    HttpqlField::ReqMethod | HttpqlField::ReqExt | HttpqlField::RespExt => 2,

                    HttpqlField::ReqHost
                    | HttpqlField::ReqPath
                    | HttpqlField::ReqQuery
                    | HttpqlField::Payload => 5,

                    HttpqlField::ReqHeader(_) | HttpqlField::RespHeader(_) => 15,

                    HttpqlField::ReqBody
                    | HttpqlField::RespBody
                    | HttpqlField::ReqRaw
                    | HttpqlField::RespRaw => 50,

                    HttpqlField::RespState | HttpqlField::Preset => 5,
                    HttpqlField::Bare => 100,
                };

                let op_multiplier = match cond.op {
                    HttpqlOperator::Regex | HttpqlOperator::Nregex => 10,
                    HttpqlOperator::Like | HttpqlOperator::Nlike => 3,
                    _ => 1,
                };

                base * op_multiplier
            }
            HttpqlExpr::Bare(_) => 100,
            HttpqlExpr::Not(inner) => inner.predicate_cost(),
            HttpqlExpr::And(list) | HttpqlExpr::Or(list) => {
                list.iter().map(|item| item.predicate_cost()).sum()
            }
        }
    }

    pub fn optimize_evaluation_order(&mut self) {
        match self {
            HttpqlExpr::And(list) => {
                for item in list.iter_mut() {
                    item.optimize_evaluation_order();
                }
                list.sort_by_key(|item| item.predicate_cost());
            }
            HttpqlExpr::Or(list) => {
                for item in list.iter_mut() {
                    item.optimize_evaluation_order();
                }
                list.sort_by_key(|item| item.predicate_cost());
            }
            HttpqlExpr::Not(inner) => {
                inner.optimize_evaluation_order();
            }
            _ => {}
        }
    }

    pub fn is_pushdown_unconstrained(
        &self,
        raw_template_req: Option<&str>,
        target_url: Option<&str>,
        negated: bool,
    ) -> bool {
        match self {
            HttpqlExpr::Condition(cond) => {
                if cond.is_exact_column() {
                    false
                } else if cond.is_fts_chunk_match() {
                    negated
                } else {
                    true
                }
            }
            HttpqlExpr::Bare(_) => negated,
            HttpqlExpr::Not(inner) => {
                inner.is_pushdown_unconstrained(raw_template_req, target_url, !negated)
            }
            HttpqlExpr::And(list) => {
                if negated {
                    list.iter().any(|item| {
                        item.is_pushdown_unconstrained(raw_template_req, target_url, true)
                    })
                } else {
                    list.is_empty()
                        || list.iter().all(|item| {
                            item.is_pushdown_unconstrained(raw_template_req, target_url, false)
                        })
                }
            }
            HttpqlExpr::Or(list) => {
                if negated {
                    list.is_empty()
                        || list.iter().all(|item| {
                            item.is_pushdown_unconstrained(raw_template_req, target_url, true)
                        })
                } else {
                    list.iter().any(|item| {
                        item.is_pushdown_unconstrained(raw_template_req, target_url, false)
                    })
                }
            }
        }
    }
}

pub fn compile_httpql_to_sql(
    builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>,
    expr: &HttpqlExpr,
) {
    match expr {
        HttpqlExpr::Condition(cond) => {
            compile_condition_to_sql(builder, cond);
        }
        HttpqlExpr::Bare(term) => {
            let pattern = format!("%{}%", term.trim());
            builder.push("(");
            builder.push("host LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR path LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR method LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR query LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR CAST(status_code AS TEXT) LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR raw_request LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR raw_response LIKE ");
            builder.push_bind(pattern);
            builder.push(")");
        }
        HttpqlExpr::Not(inner) => {
            builder.push("NOT (");
            compile_httpql_to_sql(builder, inner);
            builder.push(")");
        }
        HttpqlExpr::And(list) => {
            if list.is_empty() {
                builder.push("1=1");
            } else {
                builder.push("(");
                for (i, item) in list.iter().enumerate() {
                    if i > 0 {
                        builder.push(" AND ");
                    }
                    compile_httpql_to_sql(builder, item);
                }
                builder.push(")");
            }
        }
        HttpqlExpr::Or(list) => {
            if list.is_empty() {
                builder.push("1=0");
            } else {
                builder.push("(");
                for (i, item) in list.iter().enumerate() {
                    if i > 0 {
                        builder.push(" OR ");
                    }
                    compile_httpql_to_sql(builder, item);
                }
                builder.push(")");
            }
        }
    }
}

pub fn compile_fuzzer_httpql_to_sql(
    builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>,
    expr: &HttpqlExpr,
    raw_template_req: Option<&str>,
    target_url: Option<&str>,
) {
    compile_fuzzer_httpql_to_sql_inner(builder, expr, raw_template_req, target_url, false);
}

fn compile_fuzzer_httpql_to_sql_inner(
    builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>,
    expr: &HttpqlExpr,
    raw_template_req: Option<&str>,
    target_url: Option<&str>,
    negated: bool,
) {
    match expr {
        HttpqlExpr::Condition(cond) => {
            compile_fuzzer_condition_to_sql_inner(
                builder,
                cond,
                raw_template_req,
                target_url,
                negated,
            );
        }
        HttpqlExpr::Bare(term) => {
            if negated {
                builder.push("1=1");
            } else {
                let trimmed = term.trim();
                let pattern = format!("%{}%", trimmed);
                builder.push("(");
                builder.push("COALESCE(payload, '') LIKE ");
                builder.push_bind(pattern.clone());
                builder.push(" OR CAST(status_code AS TEXT) LIKE ");
                builder.push_bind(pattern.clone());
                builder.push(" OR CAST(response_length AS TEXT) LIKE ");
                builder.push_bind(pattern.clone());
                builder.push(" OR CAST(response_time_ms AS TEXT) LIKE ");
                builder.push_bind(pattern.clone());
                builder.push(" OR id LIKE ");
                builder.push_bind(pattern.clone());
                builder.push(" OR CAST(sort_order AS TEXT) LIKE ");
                builder.push_bind(pattern.clone());
                if trimmed.len() >= 3 {
                    let escaped = format!("\"{}\"", trimmed.replace('"', "\"\""));
                    builder.push(" OR chunk_id IN (SELECT rowid FROM fuzzer_chunks_fts WHERE fuzzer_chunks_fts MATCH ");
                    builder.push_bind(escaped);
                    builder.push(")");
                }
                builder.push(")");
            }
        }
        HttpqlExpr::Not(inner) => {
            compile_fuzzer_httpql_to_sql_inner(
                builder,
                inner,
                raw_template_req,
                target_url,
                !negated,
            );
        }
        HttpqlExpr::And(list) => {
            if negated {
                let any_unconstrained = list.iter().any(|item| {
                    item.is_pushdown_unconstrained(raw_template_req, target_url, true)
                });
                if any_unconstrained || list.is_empty() {
                    builder.push("1=1");
                } else {
                    builder.push("(");
                    for (i, item) in list.iter().enumerate() {
                        if i > 0 {
                            builder.push(" OR ");
                        }
                        compile_fuzzer_httpql_to_sql_inner(
                            builder,
                            item,
                            raw_template_req,
                            target_url,
                            true,
                        );
                    }
                    builder.push(")");
                }
            } else if list.is_empty() {
                builder.push("1=1");
            } else {
                builder.push("(");
                for (i, item) in list.iter().enumerate() {
                    if i > 0 {
                        builder.push(" AND ");
                    }
                    compile_fuzzer_httpql_to_sql_inner(
                        builder,
                        item,
                        raw_template_req,
                        target_url,
                        false,
                    );
                }
                builder.push(")");
            }
        }
        HttpqlExpr::Or(list) => {
            if negated {
                if list.is_empty() {
                    builder.push("1=1");
                } else {
                    builder.push("(");
                    for (i, item) in list.iter().enumerate() {
                        if i > 0 {
                            builder.push(" AND ");
                        }
                        compile_fuzzer_httpql_to_sql_inner(
                            builder,
                            item,
                            raw_template_req,
                            target_url,
                            true,
                        );
                    }
                    builder.push(")");
                }
            } else {
                let any_unconstrained = list.iter().any(|item| {
                    item.is_pushdown_unconstrained(raw_template_req, target_url, false)
                });
                if any_unconstrained {
                    builder.push("1=1");
                } else if list.is_empty() {
                    builder.push("1=0");
                } else {
                    builder.push("(");
                    for (i, item) in list.iter().enumerate() {
                        if i > 0 {
                            builder.push(" OR ");
                        }
                        compile_fuzzer_httpql_to_sql_inner(
                            builder,
                            item,
                            raw_template_req,
                            target_url,
                            false,
                        );
                    }
                    builder.push(")");
                }
            }
        }
    }
}

pub fn has_response_content_checks(expr: &HttpqlExpr) -> bool {
    has_in_memory_checks(expr, None, None)
}

pub fn has_in_memory_checks(
    expr: &HttpqlExpr,
    raw_template_req: Option<&str>,
    target_url: Option<&str>,
) -> bool {
    match expr {
        HttpqlExpr::Condition(cond) => match &cond.field {
            HttpqlField::RespRaw
            | HttpqlField::RespBody
            | HttpqlField::RespHeader(_)
            | HttpqlField::ReqRaw
            | HttpqlField::ReqBody
            | HttpqlField::ReqHeader(_) => true,
            _ => matches!(cond.op, HttpqlOperator::Regex | HttpqlOperator::Nregex),
        },
        HttpqlExpr::Bare(_) => true,
        HttpqlExpr::Not(inner) => has_in_memory_checks(inner, raw_template_req, target_url),
        HttpqlExpr::And(list) => {
            list.iter().any(|item| has_in_memory_checks(item, raw_template_req, target_url))
        }
        HttpqlExpr::Or(list) => {
            list.iter().any(|item| {
                has_in_memory_checks(item, raw_template_req, target_url)
                    || item.is_pushdown_unconstrained(raw_template_req, target_url, false)
            })
        }
    }
}

fn compile_fuzzer_condition_to_sql_inner(
    builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>,
    cond: &HttpqlCondition,
    raw_template_req: Option<&str>,
    target_url: Option<&str>,
    negated: bool,
) {
    if cond.is_exact_column() {
        if negated {
            builder.push("NOT (");
        }
        match &cond.field {
            HttpqlField::RespCode => {
                compile_num_field(builder, "status_code", cond.op, &cond.value);
            }
            HttpqlField::RespLen => {
                compile_num_field(builder, "response_length", cond.op, &cond.value);
            }
            HttpqlField::RespTime => {
                compile_num_field(builder, "response_time_ms", cond.op, &cond.value);
            }
            HttpqlField::ReqId => {
                compile_num_field(builder, "sort_order", cond.op, &cond.value);
            }
            HttpqlField::Payload => {
                match cond.op {
                    HttpqlOperator::Eq => {
                        let val = val_as_string(&cond.value);
                        let json_pattern = format!("%\"{}\"%", val.replace('"', "\"\""));
                        builder.push("(payload = ");
                        builder.push_bind(val);
                        builder.push(" OR payload LIKE ");
                        builder.push_bind(json_pattern);
                        builder.push(")");
                    }
                    HttpqlOperator::Ne => {
                        let val = val_as_string(&cond.value);
                        let json_pattern = format!("%\"{}\"%", val.replace('"', "\"\""));
                        builder.push("(COALESCE(payload, '') != ");
                        builder.push_bind(val);
                        builder.push(" AND COALESCE(payload, '') NOT LIKE ");
                        builder.push_bind(json_pattern);
                        builder.push(")");
                    }
                    _ => {
                        compile_str_field(builder, "COALESCE(payload, '')", cond.op, &cond.value, false);
                    }
                }
            }
            HttpqlField::ReqCreatedAt => {
                let s = val_as_string(&cond.value);
                let ms = parse_datetime_to_ms(&s).unwrap_or(0);
                let op_sym = match cond.op {
                    HttpqlOperator::Gt => " > ",
                    HttpqlOperator::Ge => " >= ",
                    HttpqlOperator::Lt => " < ",
                    HttpqlOperator::Le => " <= ",
                    HttpqlOperator::Ne => " != ",
                    _ => " = ",
                };
                builder.push("request_date");
                builder.push(op_sym);
                builder.push_bind(ms);
            }
            _ => {}
        }
        if negated {
            builder.push(")");
        }
        return;
    }

    if cond.is_fts_chunk_match() {
        if negated {
            builder.push("1=1");
        } else {
            let term = val_as_string(&cond.value);
            let trimmed = term.trim();
            let escaped = format!("\"{}\"", trimmed.replace('"', "\"\""));
            builder.push("chunk_id IN (SELECT rowid FROM fuzzer_chunks_fts WHERE fuzzer_chunks_fts MATCH ");
            builder.push_bind(escaped);
            builder.push(")");
        }
        return;
    }

    let re_ref = cond.compiled_regex.as_deref();
    match &cond.field {
        HttpqlField::RespState | HttpqlField::RespExt | HttpqlField::Preset => {
            builder.push("1=1");
        }
        HttpqlField::ReqMethod => {
            if let Some(raw) = raw_template_req {
                let meta = crate::ares_utils::parse::parse_request_line(raw.as_bytes());
                let matches = eval_str_cmp(&meta.method, cond.op, &cond.value, true, re_ref);
                let ok = if negated { !matches } else { matches };
                builder.push(if ok { "1=1" } else { "1=0" });
            } else {
                builder.push("1=1");
            }
        }
        HttpqlField::ReqHost => {
            if let Some(u) = target_url {
                let host = url::Url::parse(u).ok().and_then(|url| url.host_str().map(String::from)).unwrap_or_default();
                let matches = eval_str_cmp(&host, cond.op, &cond.value, false, re_ref);
                let ok = if negated { !matches } else { matches };
                builder.push(if ok { "1=1" } else { "1=0" });
            } else {
                builder.push("1=1");
            }
        }
        HttpqlField::ReqPath => {
            if let Some(raw) = raw_template_req {
                let meta = crate::ares_utils::parse::parse_request_line(raw.as_bytes());
                let matches = eval_str_cmp(&meta.path, cond.op, &cond.value, false, re_ref);
                let ok = if negated { !matches } else { matches };
                builder.push(if ok { "1=1" } else { "1=0" });
            } else {
                builder.push("1=1");
            }
        }
        HttpqlField::ReqQuery => {
            if let Some(raw) = raw_template_req {
                let meta = crate::ares_utils::parse::parse_request_line(raw.as_bytes());
                let query = meta.query.unwrap_or_default();
                let matches = eval_str_cmp(&query, cond.op, &cond.value, false, re_ref);
                let ok = if negated { !matches } else { matches };
                builder.push(if ok { "1=1" } else { "1=0" });
            } else {
                builder.push("1=1");
            }
        }
        HttpqlField::ReqTls => {
            if let Some(u) = target_url {
                let is_https = u.starts_with("https://");
                let target_bool = match &cond.value {
                    HttpqlValue::Bool(b) => *b,
                    HttpqlValue::String(s) => s.eq_ignore_ascii_case("https") || s.eq_ignore_ascii_case("true"),
                    _ => true,
                };
                let matches = (is_https == target_bool) == (cond.op == HttpqlOperator::Eq);
                let ok = if negated { !matches } else { matches };
                builder.push(if ok { "1=1" } else { "1=0" });
            } else {
                builder.push("1=1");
            }
        }
        _ => {
            builder.push("1=1");
        }
    }
}

fn compile_condition_to_sql(
    builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>,
    cond: &HttpqlCondition,
) {
    match &cond.field {
        HttpqlField::ReqId => {
            compile_num_field(builder, "id", cond.op, &cond.value);
        }
        HttpqlField::ReqCreatedAt => {
            let s = val_as_string(&cond.value);
            let ms = parse_datetime_to_ms(&s).unwrap_or(0);
            let op_sym = match cond.op {
                HttpqlOperator::Gt => " > ",
                HttpqlOperator::Ge => " >= ",
                HttpqlOperator::Lt => " < ",
                HttpqlOperator::Le => " <= ",
                HttpqlOperator::Ne => " != ",
                _ => " = ",
            };
            builder.push("sent_at_ms");
            builder.push(op_sym);
            builder.push_bind(ms);
        }
        HttpqlField::ReqMethod => {
            compile_str_field(builder, "method", cond.op, &cond.value, true);
        }
        HttpqlField::ReqHost => {
            compile_str_field(builder, "host", cond.op, &cond.value, false);
        }
        HttpqlField::ReqPath => {
            compile_str_field(builder, "path", cond.op, &cond.value, false);
        }
        HttpqlField::ReqQuery => {
            compile_str_field(builder, "COALESCE(query, '')", cond.op, &cond.value, false);
        }
        HttpqlField::ReqExt => {
            // Strip leading dot if user specified e.g. req.ext.eq:".js"
            match &cond.value {
                HttpqlValue::String(s) => {
                    let clean = s.trim_start_matches('.');
                    let val_clean = HttpqlValue::String(clean.to_string());
                    compile_str_field(builder, "COALESCE(extension, '')", cond.op, &val_clean, true);
                }
                HttpqlValue::List(list) => {
                    let clean_list: Vec<String> = list.iter().map(|s| s.trim_start_matches('.').to_string()).collect();
                    let val_clean = HttpqlValue::List(clean_list);
                    compile_str_field(builder, "COALESCE(extension, '')", cond.op, &val_clean, true);
                }
                _ => {
                    compile_str_field(builder, "COALESCE(extension, '')", cond.op, &cond.value, true);
                }
            }
        }
        HttpqlField::ReqPort => {
            // Derived from host or https (e.g. host:port or default 443/80)
            compile_port_field(builder, cond.op, &cond.value);
        }
        HttpqlField::ReqTls => match &cond.value {
            HttpqlValue::Bool(b) => {
                builder.push("is_https = ");
                builder.push_bind(if *b { 1i64 } else { 0i64 });
            }
            HttpqlValue::String(s) => {
                let is_https = s.eq_ignore_ascii_case("https") || s.eq_ignore_ascii_case("true");
                builder.push("is_https = ");
                builder.push_bind(if is_https { 1i64 } else { 0i64 });
            }
            _ => {
                builder.push("1=1");
            }
        },
        HttpqlField::ReqRaw | HttpqlField::ReqBody => {
            compile_str_field(builder, "raw_request", cond.op, &cond.value, false);
        }
        HttpqlField::ReqHeader(header_name) => {
            compile_header_field(builder, "raw_request", header_name.as_deref(), cond.op, &cond.value);
        }
        HttpqlField::ReqLen => {
            compile_num_field(builder, "LENGTH(raw_request)", cond.op, &cond.value);
        }

        HttpqlField::RespCode => {
            compile_num_field(builder, "status_code", cond.op, &cond.value);
        }
        HttpqlField::RespTime => {
            compile_num_field(builder, "response_time_ms", cond.op, &cond.value);
        }
        HttpqlField::RespLen => {
            compile_num_field(builder, "response_length", cond.op, &cond.value);
        }
        HttpqlField::RespRaw | HttpqlField::RespBody => {
            compile_str_field(builder, "raw_response", cond.op, &cond.value, false);
        }
        HttpqlField::RespHeader(header_name) => {
            compile_header_field(builder, "raw_response", header_name.as_deref(), cond.op, &cond.value);
        }
        HttpqlField::RespExt => {
            compile_str_field(builder, "COALESCE(extension, '')", cond.op, &cond.value, false);
        }
        HttpqlField::RespState => {
            compile_str_field(builder, "state", cond.op, &cond.value, false);
        }
        HttpqlField::Preset => {
            let val_str = val_as_string(&cond.value).to_lowercase();
            let preset_name = val_str.replace('_', "-");
            let preset_trimmed = preset_name.trim_matches(|c| c == '"' || c == '\'');
            match preset_trimmed {
                "errors-only" | "errors" | "error" | "4xx" | "5xx" => {
                    builder.push("status_code >= 400");
                }
                "2xx" | "success" | "2xx-success" => {
                    builder.push("status_code >= 200 AND status_code < 300");
                }
                "mutating" | "mutating-methods" => {
                    builder.push("method IN ('POST', 'PUT', 'PATCH', 'DELETE')");
                }
                "json" | "json-only" | "json-traffic" | "api" => {
                    builder.push("(raw_response LIKE '%content-type%json%' OR raw_request LIKE '%content-type%json%' OR raw_response LIKE '%application/json%' OR raw_request LIKE '%application/json%' OR COALESCE(extension, '') = 'json' OR path LIKE '%.json' OR path LIKE '%.json?%')");
                }
                "slow" | "slow-requests" => {
                    builder.push("response_time_ms > 1000");
                }
                "has-params" | "params" => {
                    builder.push("query IS NOT NULL AND query != ''");
                }
                "hide-static" | "no-images" | "static" | "no-static" => {
                    builder.push("(COALESCE(extension, '') = '' OR LOWER(COALESCE(extension, '')) NOT IN ('css', 'js', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'woff', 'woff2', 'ico', 'ttf', 'map', 'webp', 'avif', 'mp4', 'mp3', 'wasm', 'eot', 'otf', 'mjs', 'webmanifest', 'xml', 'txt'))");
                }
                _ => {
                    builder.push("1=0");
                }
            }
        }
        HttpqlField::Bare => {
            let term = val_as_string(&cond.value);
            let pattern = format!("%{}%", term.trim());
            builder.push("(host LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR path LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR method LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR query LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR CAST(status_code AS TEXT) LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR raw_request LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" OR raw_response LIKE ");
            builder.push_bind(pattern);
            builder.push(")");
        }
        HttpqlField::Payload => {
            compile_str_field(builder, "COALESCE(query, '')", cond.op, &cond.value, false);
        }
    }
}

fn regex_to_sql_like_candidate(re_str: &str) -> String {
    let mut s = re_str.trim();
    let anchored_start = s.starts_with('^');
    if anchored_start {
        s = &s[1..];
    }
    let anchored_end = s.ends_with('$');
    if anchored_end {
        s = &s[..s.len() - 1];
    }

    let mut cleaned = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '.' && chars.peek() == Some(&'*') {
            chars.next();
            cleaned.push('%');
        } else if c == '\\' {
            if let Some(next_c) = chars.next() {
                cleaned.push(next_c);
            }
        } else if c == '(' || c == ')' || c == '[' || c == ']' || c == '+' || c == '?' {
            // Drop grouping punctuation for broad LIKE candidate filter
        } else {
            cleaned.push(c);
        }
    }
    let core = cleaned.trim();
    if core.is_empty() {
        return "%".to_string();
    }
    match (anchored_start, anchored_end) {
        (true, true) => core.to_string(),
        (true, false) => format!("{}%", core),
        (false, true) => format!("%{}", core),
        (false, false) => format!("%{}%", core),
    }
}

fn compile_str_field(
    builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>,
    col: &str,
    op: HttpqlOperator,
    val: &HttpqlValue,
    case_insensitive: bool,
) {
    match op {
        HttpqlOperator::Eq => match val {
            HttpqlValue::List(list) => {
                if list.is_empty() {
                    builder.push("1=0");
                } else {
                    builder.push(col);
                    builder.push(" IN (");
                    let mut sep = builder.separated(", ");
                    for item in list {
                        sep.push_bind(item.clone());
                    }
                    builder.push(")");
                }
            }
            _ => {
                let s = val_as_string(val);
                if case_insensitive {
                    builder.push(col);
                    builder.push(" = ");
                    builder.push_bind(s);
                    builder.push(" COLLATE NOCASE");
                } else {
                    builder.push(col);
                    builder.push(" = ");
                    builder.push_bind(s);
                }
            }
        },
        HttpqlOperator::Ne => match val {
            HttpqlValue::List(list) => {
                if list.is_empty() {
                    builder.push("1=1");
                } else {
                    builder.push(col);
                    builder.push(" NOT IN (");
                    let mut sep = builder.separated(", ");
                    for item in list {
                        sep.push_bind(item.clone());
                    }
                    builder.push(")");
                }
            }
            _ => {
                let s = val_as_string(val);
                builder.push(col);
                builder.push(" != ");
                builder.push_bind(s);
            }
        },
        HttpqlOperator::Cont => match val {
            HttpqlValue::List(list) => {
                if list.is_empty() {
                    builder.push("1=0");
                } else {
                    builder.push("(");
                    let mut first = true;
                    for item in list {
                        if !first {
                            builder.push(" OR ");
                        }
                        first = false;
                        let pattern = format!("%{}%", item);
                        builder.push(col);
                        builder.push(" LIKE ");
                        builder.push_bind(pattern);
                    }
                    builder.push(")");
                }
            }
            _ => {
                let s = val_as_string(val);
                let pattern = format!("%{}%", s);
                builder.push(col);
                builder.push(" LIKE ");
                builder.push_bind(pattern);
            }
        },
        HttpqlOperator::Ncont => match val {
            HttpqlValue::List(list) => {
                if list.is_empty() {
                    builder.push("1=1");
                } else {
                    builder.push("(");
                    let mut first = true;
                    for item in list {
                        if !first {
                            builder.push(" AND ");
                        }
                        first = false;
                        let pattern = format!("%{}%", item);
                        builder.push(col);
                        builder.push(" NOT LIKE ");
                        builder.push_bind(pattern);
                    }
                    builder.push(")");
                }
            }
            _ => {
                let s = val_as_string(val);
                let pattern = format!("%{}%", s);
                builder.push(col);
                builder.push(" NOT LIKE ");
                builder.push_bind(pattern);
            }
        },
        HttpqlOperator::Sw => match val {
            HttpqlValue::List(list) => {
                if list.is_empty() {
                    builder.push("1=0");
                } else {
                    builder.push("(");
                    let mut first = true;
                    for item in list {
                        if !first {
                            builder.push(" OR ");
                        }
                        first = false;
                        let pattern = format!("{}%", item);
                        builder.push(col);
                        builder.push(" LIKE ");
                        builder.push_bind(pattern);
                    }
                    builder.push(")");
                }
            }
            _ => {
                let s = val_as_string(val);
                let pattern = format!("{}%", s);
                builder.push(col);
                builder.push(" LIKE ");
                builder.push_bind(pattern);
            }
        },
        HttpqlOperator::Nsw => match val {
            HttpqlValue::List(list) => {
                if list.is_empty() {
                    builder.push("1=1");
                } else {
                    builder.push("(");
                    let mut first = true;
                    for item in list {
                        if !first {
                            builder.push(" AND ");
                        }
                        first = false;
                        let pattern = format!("{}%", item);
                        builder.push(col);
                        builder.push(" NOT LIKE ");
                        builder.push_bind(pattern);
                    }
                    builder.push(")");
                }
            }
            _ => {
                let s = val_as_string(val);
                let pattern = format!("{}%", s);
                builder.push(col);
                builder.push(" NOT LIKE ");
                builder.push_bind(pattern);
            }
        },
        HttpqlOperator::Ew => match val {
            HttpqlValue::List(list) => {
                if list.is_empty() {
                    builder.push("1=0");
                } else {
                    builder.push("(");
                    let mut first = true;
                    for item in list {
                        if !first {
                            builder.push(" OR ");
                        }
                        first = false;
                        let pattern = format!("%{}", item);
                        builder.push(col);
                        builder.push(" LIKE ");
                        builder.push_bind(pattern);
                    }
                    builder.push(")");
                }
            }
            _ => {
                let s = val_as_string(val);
                let pattern = format!("%{}", s);
                builder.push(col);
                builder.push(" LIKE ");
                builder.push_bind(pattern);
            }
        },
        HttpqlOperator::New => match val {
            HttpqlValue::List(list) => {
                if list.is_empty() {
                    builder.push("1=1");
                } else {
                    builder.push("(");
                    let mut first = true;
                    for item in list {
                        if !first {
                            builder.push(" AND ");
                        }
                        first = false;
                        let pattern = format!("%{}", item);
                        builder.push(col);
                        builder.push(" NOT LIKE ");
                        builder.push_bind(pattern);
                    }
                    builder.push(")");
                }
            }
            _ => {
                let s = val_as_string(val);
                let pattern = format!("%{}", s);
                builder.push(col);
                builder.push(" NOT LIKE ");
                builder.push_bind(pattern);
            }
        },
        HttpqlOperator::In => {
            let list = val_as_list(val);
            if list.is_empty() {
                builder.push("1=0");
            } else {
                builder.push(col);
                builder.push(" IN (");
                let mut sep = builder.separated(", ");
                for item in list {
                    sep.push_bind(item);
                }
                builder.push(")");
            }
        }
        HttpqlOperator::Nin => {
            let list = val_as_list(val);
            if list.is_empty() {
                builder.push("1=1");
            } else {
                builder.push(col);
                builder.push(" NOT IN (");
                let mut sep = builder.separated(", ");
                for item in list {
                    sep.push_bind(item);
                }
                builder.push(")");
            }
        }
        HttpqlOperator::Like => {
            let s = val_as_string(val);
            builder.push(col);
            builder.push(" LIKE ");
            builder.push_bind(s);
        }
        HttpqlOperator::Nlike => {
            let s = val_as_string(val);
            builder.push(col);
            builder.push(" NOT LIKE ");
            builder.push_bind(s);
        }
        HttpqlOperator::Regex => {
            let s = val_as_string(val);
            let pattern = regex_to_sql_like_candidate(&s);
            builder.push(col);
            builder.push(" LIKE ");
            builder.push_bind(pattern);
        }
        HttpqlOperator::Nregex => {
            let s = val_as_string(val);
            let pattern = regex_to_sql_like_candidate(&s);
            builder.push(col);
            builder.push(" NOT LIKE ");
            builder.push_bind(pattern);
        }
        HttpqlOperator::Gt | HttpqlOperator::Ge | HttpqlOperator::Lt | HttpqlOperator::Le => {
            // String comparison
            let s = val_as_string(val);
            let op_sym = match op {
                HttpqlOperator::Gt => " > ",
                HttpqlOperator::Ge => " >= ",
                HttpqlOperator::Lt => " < ",
                HttpqlOperator::Le => " <= ",
                _ => " = ",
            };
            builder.push(col);
            builder.push(op_sym);
            builder.push_bind(s);
        }
    }
}

fn compile_num_field(
    builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>,
    col: &str,
    op: HttpqlOperator,
    val: &HttpqlValue,
) {
    match op {
        HttpqlOperator::In => {
            let list = val_as_num_list(val);
            if list.is_empty() {
                builder.push("1=0");
            } else {
                builder.push(col);
                builder.push(" IN (");
                let mut sep = builder.separated(", ");
                for item in list {
                    sep.push_bind(item);
                }
                builder.push(")");
            }
        }
        HttpqlOperator::Nin => {
            let list = val_as_num_list(val);
            if list.is_empty() {
                builder.push("1=1");
            } else {
                builder.push(col);
                builder.push(" NOT IN (");
                let mut sep = builder.separated(", ");
                for item in list {
                    sep.push_bind(item);
                }
                builder.push(")");
            }
        }
        _ => {
            let n = val_as_num(val);
            let op_sym = match op {
                HttpqlOperator::Eq => " = ",
                HttpqlOperator::Ne => " != ",
                HttpqlOperator::Gt => " > ",
                HttpqlOperator::Ge => " >= ",
                HttpqlOperator::Lt => " < ",
                HttpqlOperator::Le => " <= ",
                _ => " = ",
            };
            builder.push(col);
            builder.push(op_sym);
            builder.push_bind(n);
        }
    }
}

fn compile_port_field(
    builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>,
    op: HttpqlOperator,
    val: &HttpqlValue,
) {
    let port_num = val_as_num(val);
    let op_sym = match op {
        HttpqlOperator::Eq => " = ",
        HttpqlOperator::Ne => " != ",
        HttpqlOperator::Gt => " > ",
        HttpqlOperator::Ge => " >= ",
        HttpqlOperator::Lt => " < ",
        HttpqlOperator::Le => " <= ",
        _ => " = ",
    };

    // SQL expression to extract port from host or fallback to is_https (443 vs 80)
    builder.push(
        "(CASE WHEN INSTR(host, ':') > 0 THEN CAST(SUBSTR(host, INSTR(host, ':') + 1) AS INTEGER) WHEN is_https = 1 THEN 443 ELSE 80 END)",
    );
    builder.push(op_sym);
    builder.push_bind(port_num);
}

fn push_header_line_expr(builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>, col: &str, hname: &str) {
    let header_prefix = format!("{}:", hname.to_lowercase());
    builder.push("SUBSTR(");
    builder.push(col);
    builder.push(", INSTR(LOWER(");
    builder.push(col);
    builder.push("), ");
    builder.push_bind(header_prefix.clone());
    builder.push("), CASE WHEN INSTR(SUBSTR(");
    builder.push(col);
    builder.push(", INSTR(LOWER(");
    builder.push(col);
    builder.push("), ");
    builder.push_bind(header_prefix.clone());
    builder.push(")), CHAR(10)) > 0 THEN INSTR(SUBSTR(");
    builder.push(col);
    builder.push(", INSTR(LOWER(");
    builder.push(col);
    builder.push("), ");
    builder.push_bind(header_prefix.clone());
    builder.push(")), CHAR(10)) ELSE LENGTH(");
    builder.push(col);
    builder.push(") END)");
}

fn push_header_val_expr(builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>, col: &str, hname: &str) {
    let header_prefix = format!("{}:", hname.to_lowercase());
    let prefix_len = header_prefix.len() as i64 + 1;
    builder.push("TRIM(SUBSTR(");
    push_header_line_expr(builder, col, hname);
    builder.push(", ");
    builder.push_bind(prefix_len);
    builder.push("), ' ' || CHAR(13) || CHAR(10))");
}

fn compile_header_field(
    builder: &mut sqlx::QueryBuilder<sqlx::Sqlite>,
    col: &str,
    header_name: Option<&str>,
    op: HttpqlOperator,
    val: &HttpqlValue,
) {
    if let Some(hname) = header_name {
        let hname_lower = hname.to_lowercase();
        let header_prefix = format!("{}:", hname_lower);

        match op {
            HttpqlOperator::Cont | HttpqlOperator::Like | HttpqlOperator::Regex => {
                let target_val = val_as_string(val);
                let pattern = format!("%{}%", target_val.to_lowercase());
                builder.push("(INSTR(LOWER(");
                builder.push(col);
                builder.push("), ");
                builder.push_bind(header_prefix.clone());
                builder.push(") > 0 AND LOWER(");
                push_header_line_expr(builder, col, &hname_lower);
                builder.push(") LIKE ");
                builder.push_bind(pattern);
                builder.push(")");
            }
            HttpqlOperator::Ncont | HttpqlOperator::Nlike | HttpqlOperator::Nregex => {
                let target_val = val_as_string(val);
                let pattern = format!("%{}%", target_val.to_lowercase());
                builder.push("(INSTR(LOWER(");
                builder.push(col);
                builder.push("), ");
                builder.push_bind(header_prefix.clone());
                builder.push(") = 0 OR LOWER(");
                push_header_line_expr(builder, col, &hname_lower);
                builder.push(") NOT LIKE ");
                builder.push_bind(pattern);
                builder.push(")");
            }
            HttpqlOperator::Eq => match val {
                HttpqlValue::List(list) => {
                    if list.is_empty() {
                        builder.push("1=0");
                    } else {
                        builder.push("(INSTR(LOWER(");
                        builder.push(col);
                        builder.push("), ");
                        builder.push_bind(header_prefix.clone());
                        builder.push(") > 0 AND LOWER(");
                        push_header_val_expr(builder, col, &hname_lower);
                        builder.push(") IN (");
                        let mut sep = builder.separated(", ");
                        for item in list {
                            sep.push_bind(item.to_lowercase());
                        }
                        builder.push("))");
                    }
                }
                _ => {
                    let target_val = val_as_string(val).to_lowercase();
                    builder.push("(INSTR(LOWER(");
                    builder.push(col);
                    builder.push("), ");
                    builder.push_bind(header_prefix.clone());
                    builder.push(") > 0 AND LOWER(");
                    push_header_val_expr(builder, col, &hname_lower);
                    builder.push(") = ");
                    builder.push_bind(target_val);
                    builder.push(")");
                }
            },
            HttpqlOperator::Ne => match val {
                HttpqlValue::List(list) => {
                    if list.is_empty() {
                        builder.push("1=1");
                    } else {
                        builder.push("(INSTR(LOWER(");
                        builder.push(col);
                        builder.push("), ");
                        builder.push_bind(header_prefix.clone());
                        builder.push(") = 0 OR LOWER(");
                        push_header_val_expr(builder, col, &hname_lower);
                        builder.push(") NOT IN (");
                        let mut sep = builder.separated(", ");
                        for item in list {
                            sep.push_bind(item.to_lowercase());
                        }
                        builder.push("))");
                    }
                }
                _ => {
                    let target_val = val_as_string(val).to_lowercase();
                    builder.push("(INSTR(LOWER(");
                    builder.push(col);
                    builder.push("), ");
                    builder.push_bind(header_prefix.clone());
                    builder.push(") = 0 OR LOWER(");
                    push_header_val_expr(builder, col, &hname_lower);
                    builder.push(") != ");
                    builder.push_bind(target_val);
                    builder.push(")");
                }
            },
            HttpqlOperator::Sw => {
                let target_val = val_as_string(val).to_lowercase();
                let pattern = format!("{}%", target_val);
                builder.push("(INSTR(LOWER(");
                builder.push(col);
                builder.push("), ");
                builder.push_bind(header_prefix.clone());
                builder.push(") > 0 AND LOWER(");
                push_header_val_expr(builder, col, &hname_lower);
                builder.push(") LIKE ");
                builder.push_bind(pattern);
                builder.push(")");
            }
            HttpqlOperator::Nsw => {
                let target_val = val_as_string(val).to_lowercase();
                let pattern = format!("{}%", target_val);
                builder.push("(INSTR(LOWER(");
                builder.push(col);
                builder.push("), ");
                builder.push_bind(header_prefix.clone());
                builder.push(") = 0 OR LOWER(");
                push_header_val_expr(builder, col, &hname_lower);
                builder.push(") NOT LIKE ");
                builder.push_bind(pattern);
                builder.push(")");
            }
            HttpqlOperator::Ew => {
                let target_val = val_as_string(val).to_lowercase();
                let pattern = format!("%{}", target_val);
                builder.push("(INSTR(LOWER(");
                builder.push(col);
                builder.push("), ");
                builder.push_bind(header_prefix.clone());
                builder.push(") > 0 AND LOWER(");
                push_header_val_expr(builder, col, &hname_lower);
                builder.push(") LIKE ");
                builder.push_bind(pattern);
                builder.push(")");
            }
            HttpqlOperator::New => {
                let target_val = val_as_string(val).to_lowercase();
                let pattern = format!("%{}", target_val);
                builder.push("(INSTR(LOWER(");
                builder.push(col);
                builder.push("), ");
                builder.push_bind(header_prefix.clone());
                builder.push(") = 0 OR LOWER(");
                push_header_val_expr(builder, col, &hname_lower);
                builder.push(") NOT LIKE ");
                builder.push_bind(pattern);
                builder.push(")");
            }
            HttpqlOperator::In => {
                let list = val_as_list(val);
                if list.is_empty() {
                    builder.push("1=0");
                } else {
                    builder.push("(INSTR(LOWER(");
                    builder.push(col);
                    builder.push("), ");
                    builder.push_bind(header_prefix.clone());
                    builder.push(") > 0 AND LOWER(");
                    push_header_val_expr(builder, col, &hname_lower);
                    builder.push(") IN (");
                    let mut sep = builder.separated(", ");
                    for item in list {
                        sep.push_bind(item.to_lowercase());
                    }
                    builder.push("))");
                }
            }
            HttpqlOperator::Nin => {
                let list = val_as_list(val);
                if list.is_empty() {
                    builder.push("1=1");
                } else {
                    builder.push("(INSTR(LOWER(");
                    builder.push(col);
                    builder.push("), ");
                    builder.push_bind(header_prefix.clone());
                    builder.push(") = 0 OR LOWER(");
                    push_header_val_expr(builder, col, &hname_lower);
                    builder.push(") NOT IN (");
                    let mut sep = builder.separated(", ");
                    for item in list {
                        sep.push_bind(item.to_lowercase());
                    }
                    builder.push("))");
                }
            }
            _ => {
                let target_val = val_as_string(val).to_lowercase();
                let pattern = format!("%{}%", target_val);
                builder.push("(INSTR(LOWER(");
                builder.push(col);
                builder.push("), ");
                builder.push_bind(header_prefix.clone());
                builder.push(") > 0 AND LOWER(");
                push_header_line_expr(builder, col, &hname_lower);
                builder.push(") LIKE ");
                builder.push_bind(pattern);
                builder.push(")");
            }
        }
    } else {
        // No specific header name given
        let target_val = val_as_string(val);
        let pattern = format!("%{}%", target_val);
        match op {
            HttpqlOperator::Ne
            | HttpqlOperator::Ncont
            | HttpqlOperator::Nlike
            | HttpqlOperator::Nregex
            | HttpqlOperator::Nsw
            | HttpqlOperator::New
            | HttpqlOperator::Nin => {
                builder.push(col);
                builder.push(" NOT LIKE ");
                builder.push_bind(pattern);
            }
            _ => {
                builder.push(col);
                builder.push(" LIKE ");
                builder.push_bind(pattern);
            }
        }
    }
}

fn val_as_string(val: &HttpqlValue) -> String {
    match val {
        HttpqlValue::String(s) => s.clone(),
        HttpqlValue::Number(n) => n.to_string(),
        HttpqlValue::Bool(b) => b.to_string(),
        HttpqlValue::List(l) => l.join(","),
    }
}

fn val_as_num(val: &HttpqlValue) -> i64 {
    match val {
        HttpqlValue::Number(n) => *n,
        HttpqlValue::String(s) => s.parse().unwrap_or(0),
        HttpqlValue::Bool(b) => {
            if *b {
                1
            } else {
                0
            }
        }
        HttpqlValue::List(l) => l.first().and_then(|s| s.parse().ok()).unwrap_or(0),
    }
}

fn val_as_list(val: &HttpqlValue) -> Vec<String> {
    match val {
        HttpqlValue::List(l) => l.clone(),
        HttpqlValue::String(s) => vec![s.clone()],
        HttpqlValue::Number(n) => vec![n.to_string()],
        HttpqlValue::Bool(b) => vec![b.to_string()],
    }
}

fn val_as_num_list(val: &HttpqlValue) -> Vec<i64> {
    match val {
        HttpqlValue::List(l) => l.iter().filter_map(|s| s.parse::<i64>().ok()).collect(),
        HttpqlValue::Number(n) => vec![*n],
        HttpqlValue::String(s) => s.parse::<i64>().map(|n| vec![n]).unwrap_or_default(),
        HttpqlValue::Bool(b) => vec![if *b { 1 } else { 0 }],
    }
}

// -----------------------------------------------------------------------------
// In-Memory Evaluator (for Memory Rows / Summary Rows / Scope Filtering)
// -----------------------------------------------------------------------------

pub trait HttpTransactionEvaluable {
    fn eval_id(&self) -> u32;
    fn eval_method(&self) -> &str;
    fn eval_host(&self) -> &str;
    fn eval_path(&self) -> &str;
    fn eval_query(&self) -> Option<&str>;
    fn eval_ext(&self) -> Option<&str>;
    fn eval_status_code(&self) -> i64;
    fn eval_response_length(&self) -> i64;
    fn eval_response_time_ms(&self) -> i64;
    fn eval_sent_at_ms(&self) -> i64;
    fn eval_state(&self) -> &str;
    fn eval_is_https(&self) -> bool;
    fn eval_raw_request(&self) -> Option<&str>;
    fn eval_raw_response(&self) -> Option<&str>;
    fn eval_payload(&self) -> Option<&str> {
        None
    }
}

pub struct FuzzerEvaluableItem<'a> {
    pub id: u32,
    pub method: &'a str,
    pub host: &'a str,
    pub path: &'a str,
    pub query: Option<&'a str>,
    pub ext: Option<&'a str>,
    pub status_code: i64,
    pub response_length: i64,
    pub response_time_ms: i64,
    pub sent_at_ms: i64,
    pub state: &'a str,
    pub is_https: bool,
    pub raw_request: Option<&'a str>,
    pub raw_response: Option<&'a str>,
    pub payload: Option<&'a str>,
}

impl<'a> HttpTransactionEvaluable for FuzzerEvaluableItem<'a> {
    fn eval_id(&self) -> u32 { self.id }
    fn eval_method(&self) -> &str { self.method }
    fn eval_host(&self) -> &str { self.host }
    fn eval_path(&self) -> &str { self.path }
    fn eval_query(&self) -> Option<&str> { self.query }
    fn eval_ext(&self) -> Option<&str> { self.ext }
    fn eval_status_code(&self) -> i64 { self.status_code }
    fn eval_response_length(&self) -> i64 { self.response_length }
    fn eval_response_time_ms(&self) -> i64 { self.response_time_ms }
    fn eval_sent_at_ms(&self) -> i64 { self.sent_at_ms }
    fn eval_state(&self) -> &str { self.state }
    fn eval_is_https(&self) -> bool { self.is_https }
    fn eval_raw_request(&self) -> Option<&str> { self.raw_request }
    fn eval_raw_response(&self) -> Option<&str> { self.raw_response }
    fn eval_payload(&self) -> Option<&str> { self.payload }
}

impl HttpqlExpr {
    pub fn evaluate<T: HttpTransactionEvaluable>(&self, item: &T) -> bool {
        match self {
            HttpqlExpr::Condition(cond) => eval_condition(cond, item),
            HttpqlExpr::Bare(term) => {
                let term_lower = term.to_lowercase();
                if let Some(p) = item.eval_payload() {
                    if p.to_lowercase().contains(&term_lower) {
                        return true;
                    }
                }
                if item.eval_host().to_lowercase().contains(&term_lower) {
                    return true;
                }
                if item.eval_path().to_lowercase().contains(&term_lower) {
                    return true;
                }
                if item.eval_method().to_lowercase().contains(&term_lower) {
                    return true;
                }
                if let Some(q) = item.eval_query() {
                    if q.to_lowercase().contains(&term_lower) {
                        return true;
                    }
                }
                if item.eval_status_code().to_string().contains(&term_lower) {
                    return true;
                }
                if let Some(req) = item.eval_raw_request() {
                    if req.to_lowercase().contains(&term_lower) {
                        return true;
                    }
                }
                if let Some(res) = item.eval_raw_response() {
                    if res.to_lowercase().contains(&term_lower) {
                        return true;
                    }
                }
                false
            }
            HttpqlExpr::Not(inner) => !inner.evaluate(item),
            HttpqlExpr::And(list) => list.iter().all(|expr| expr.evaluate(item)),
            HttpqlExpr::Or(list) => list.iter().any(|expr| expr.evaluate(item)),
        }
    }
}

fn eval_condition<T: HttpTransactionEvaluable>(cond: &HttpqlCondition, item: &T) -> bool {
    let re_ref = cond.compiled_regex.as_deref();
    match &cond.field {
        HttpqlField::ReqId => eval_num_cmp(item.eval_id() as i64, cond.op, &cond.value),
        HttpqlField::ReqCreatedAt => {
            let s = val_as_string(&cond.value);
            let ms = parse_datetime_to_ms(&s).unwrap_or(0);
            eval_num_cmp(item.eval_sent_at_ms(), cond.op, &HttpqlValue::Number(ms))
        }
        HttpqlField::ReqMethod => eval_str_cmp(item.eval_method(), cond.op, &cond.value, true, re_ref),
        HttpqlField::ReqHost => eval_str_cmp(item.eval_host(), cond.op, &cond.value, false, re_ref),
        HttpqlField::ReqPath => eval_str_cmp(item.eval_path(), cond.op, &cond.value, false, re_ref),
        HttpqlField::ReqQuery => {
            let q = item.eval_query().unwrap_or("");
            eval_str_cmp(q, cond.op, &cond.value, false, re_ref)
        }
        HttpqlField::ReqExt => {
            let ext = item.eval_ext().unwrap_or("").trim_start_matches('.');
            match &cond.value {
                HttpqlValue::String(s) => {
                    let clean = s.trim_start_matches('.');
                    eval_str_cmp(ext, cond.op, &HttpqlValue::String(clean.to_string()), true, re_ref)
                }
                HttpqlValue::List(list) => {
                    let clean_list: Vec<String> = list.iter().map(|s| s.trim_start_matches('.').to_string()).collect();
                    eval_str_cmp(ext, cond.op, &HttpqlValue::List(clean_list), true, re_ref)
                }
                _ => eval_str_cmp(ext, cond.op, &cond.value, true, re_ref),
            }
        }
        HttpqlField::ReqPort => {
            let host = item.eval_host();
            let port = if let Some(idx) = host.find(':') {
                host[idx + 1..].parse::<i64>().unwrap_or(80)
            } else if item.eval_is_https() {
                443
            } else {
                80
            };
            eval_num_cmp(port, cond.op, &cond.value)
        }
        HttpqlField::ReqTls => {
            let is_https = item.eval_is_https();
            match &cond.value {
                HttpqlValue::Bool(b) => is_https == *b,
                HttpqlValue::String(s) => {
                    let wants = s.eq_ignore_ascii_case("https") || s.eq_ignore_ascii_case("true");
                    is_https == wants
                }
                _ => true,
            }
        }
        HttpqlField::ReqRaw | HttpqlField::ReqBody => {
            let raw = item.eval_raw_request().unwrap_or("");
            eval_str_cmp(raw, cond.op, &cond.value, false, re_ref)
        }
        HttpqlField::ReqHeader(hname) => {
            let raw = item.eval_raw_request().unwrap_or("");
            eval_header_cmp(raw, hname.as_deref(), cond.op, &cond.value, re_ref)
        }
        HttpqlField::ReqLen => {
            let len = item.eval_raw_request().map(|s| s.len() as i64).unwrap_or(0);
            eval_num_cmp(len, cond.op, &cond.value)
        }

        HttpqlField::RespCode => eval_num_cmp(item.eval_status_code(), cond.op, &cond.value),
        HttpqlField::RespTime => eval_num_cmp(item.eval_response_time_ms(), cond.op, &cond.value),
        HttpqlField::RespLen => eval_num_cmp(item.eval_response_length(), cond.op, &cond.value),
        HttpqlField::RespRaw => {
            let raw = item.eval_raw_response().unwrap_or("");
            eval_str_cmp(raw, cond.op, &cond.value, false, re_ref)
        }
        HttpqlField::RespBody => {
            let raw = item.eval_raw_response().unwrap_or("");
            let (_, body) = crate::ares_utils::parse::split_message(raw);
            eval_str_cmp(body, cond.op, &cond.value, false, re_ref)
        }
        HttpqlField::RespHeader(hname) => {
            let raw = item.eval_raw_response().unwrap_or("");
            eval_header_cmp(raw, hname.as_deref(), cond.op, &cond.value, re_ref)
        }
        HttpqlField::RespExt => {
            let ext = item.eval_ext().unwrap_or("").trim_start_matches('.');
            eval_str_cmp(ext, cond.op, &cond.value, true, re_ref)
        }
        HttpqlField::RespState => eval_str_cmp(item.eval_state(), cond.op, &cond.value, false, re_ref),
        HttpqlField::Preset => {
            let val_str = val_as_string(&cond.value).to_lowercase();
            let preset_name = val_str.replace('_', "-");
            let preset_trimmed = preset_name.trim_matches(|c| c == '"' || c == '\'');
            match preset_trimmed {
                "hide-static" | "no-images" | "static" | "no-static" => {
                    let ext = item.eval_ext().unwrap_or("").trim_start_matches('.').to_lowercase();
                    !["css", "js", "png", "jpg", "jpeg", "gif", "svg", "woff", "woff2", "ico", "ttf", "map", "webp", "avif", "mp4", "mp3", "wasm"].contains(&ext.as_str())
                }
                "errors-only" | "errors" | "error" | "4xx" | "5xx" => item.eval_status_code() >= 400,
                "2xx" | "success" | "2xx-success" => item.eval_status_code() >= 200 && item.eval_status_code() < 300,
                "mutating" | "mutating-methods" => {
                    let m = item.eval_method().to_uppercase();
                    ["POST", "PUT", "PATCH", "DELETE"].contains(&m.as_str())
                }
                "json" | "json-only" | "json-traffic" | "api" => {
                    let ext = item.eval_ext().unwrap_or("").trim_start_matches('.').to_lowercase();
                    if ext == "json" {
                        return true;
                    }
                    let path = item.eval_path().to_lowercase();
                    if path.ends_with(".json") || path.contains(".json?") {
                        return true;
                    }
                    let req_raw = item.eval_raw_request().unwrap_or("");
                    let res_raw = item.eval_raw_response().unwrap_or("");
                    let req_lower = req_raw.to_lowercase();
                    let res_lower = res_raw.to_lowercase();
                    (req_lower.contains("content-type") && req_lower.contains("json"))
                        || (res_lower.contains("content-type") && res_lower.contains("json"))
                        || req_lower.contains("application/json")
                }
                "slow" | "slow-requests" => item.eval_response_time_ms() > 1000,
                "has-params" | "params" => item.eval_query().map(|q| !q.is_empty()).unwrap_or(false),
                _ => false,
            }
        }
        HttpqlField::Bare => {
            let s = val_as_string(&cond.value).to_lowercase();
            item.eval_payload().map(|p| p.to_lowercase().contains(&s)).unwrap_or(false)
                || item.eval_host().to_lowercase().contains(&s)
                || item.eval_path().to_lowercase().contains(&s)
                || item.eval_method().to_lowercase().contains(&s)
                || item.eval_query().map(|q| q.to_lowercase().contains(&s)).unwrap_or(false)
                || item.eval_status_code().to_string().contains(&s)
                || item.eval_raw_request().map(|r| r.to_lowercase().contains(&s)).unwrap_or(false)
                || item.eval_raw_response().map(|r| r.to_lowercase().contains(&s)).unwrap_or(false)
        }
        HttpqlField::Payload => {
            let p = item.eval_payload().unwrap_or("");
            if p.starts_with('[') && p.ends_with(']') {
                if let Ok(arr) = serde_json::from_str::<Vec<String>>(p) {
                    let exp_str = val_as_string(&cond.value);
                    match cond.op {
                        HttpqlOperator::Eq => return arr.iter().any(|v| v == &exp_str),
                        HttpqlOperator::Ne => return !arr.iter().any(|v| v == &exp_str),
                        HttpqlOperator::Cont => return arr.iter().any(|v| v.contains(&exp_str)),
                        HttpqlOperator::Ncont => return !arr.iter().any(|v| v.contains(&exp_str)),
                        _ => {}
                    }
                }
            }
            eval_str_cmp(p, cond.op, &cond.value, false, re_ref)
        }
    }
}

fn eval_str_cmp(
    val: &str,
    op: HttpqlOperator,
    expected: &HttpqlValue,
    case_insensitive: bool,
    compiled_regex: Option<&Regex>,
) -> bool {
    let val_cmp = if case_insensitive {
        val.to_lowercase()
    } else {
        val.to_string()
    };

    match op {
        HttpqlOperator::Eq => match expected {
            HttpqlValue::List(list) => {
                if case_insensitive {
                    list.iter().any(|item| item.eq_ignore_ascii_case(val))
                } else {
                    list.iter().any(|item| item == val)
                }
            }
            _ => {
                let exp_str = val_as_string(expected);
                if case_insensitive {
                    val.eq_ignore_ascii_case(&exp_str)
                } else {
                    val == exp_str
                }
            }
        },
        HttpqlOperator::Ne => match expected {
            HttpqlValue::List(list) => {
                if case_insensitive {
                    !list.iter().any(|item| item.eq_ignore_ascii_case(val))
                } else {
                    !list.iter().any(|item| item == val)
                }
            }
            _ => {
                let exp_str = val_as_string(expected);
                if case_insensitive {
                    !val.eq_ignore_ascii_case(&exp_str)
                } else {
                    val != exp_str
                }
            }
        },
        HttpqlOperator::Cont => match expected {
            HttpqlValue::List(list) => {
                let v = val.to_lowercase();
                list.iter().any(|item| v.contains(&item.to_lowercase()))
            }
            _ => {
                let exp_str = val_as_string(expected).to_lowercase();
                val.to_lowercase().contains(&exp_str)
            }
        },
        HttpqlOperator::Ncont => match expected {
            HttpqlValue::List(list) => {
                let v = val.to_lowercase();
                !list.iter().any(|item| v.contains(&item.to_lowercase()))
            }
            _ => {
                let exp_str = val_as_string(expected).to_lowercase();
                !val.to_lowercase().contains(&exp_str)
            }
        },
        HttpqlOperator::Sw => match expected {
            HttpqlValue::List(list) => {
                let v = val.to_lowercase();
                list.iter().any(|item| v.starts_with(&item.to_lowercase()))
            }
            _ => {
                let exp_str = val_as_string(expected).to_lowercase();
                val.to_lowercase().starts_with(&exp_str)
            }
        },
        HttpqlOperator::Nsw => match expected {
            HttpqlValue::List(list) => {
                let v = val.to_lowercase();
                !list.iter().any(|item| v.starts_with(&item.to_lowercase()))
            }
            _ => {
                let exp_str = val_as_string(expected).to_lowercase();
                !val.to_lowercase().starts_with(&exp_str)
            }
        },
        HttpqlOperator::Ew => match expected {
            HttpqlValue::List(list) => {
                let v = val.to_lowercase();
                list.iter().any(|item| v.ends_with(&item.to_lowercase()))
            }
            _ => {
                let exp_str = val_as_string(expected).to_lowercase();
                val.to_lowercase().ends_with(&exp_str)
            }
        },
        HttpqlOperator::New => match expected {
            HttpqlValue::List(list) => {
                let v = val.to_lowercase();
                !list.iter().any(|item| v.ends_with(&item.to_lowercase()))
            }
            _ => {
                let exp_str = val_as_string(expected).to_lowercase();
                !val.to_lowercase().ends_with(&exp_str)
            }
        },
        HttpqlOperator::In => match expected {
            HttpqlValue::List(list) => {
                if case_insensitive {
                    list.iter().any(|item| item.eq_ignore_ascii_case(val))
                } else {
                    list.iter().any(|item| item == val)
                }
            }
            _ => {
                let exp_str = val_as_string(expected);
                if case_insensitive {
                    val.eq_ignore_ascii_case(&exp_str)
                } else {
                    val == exp_str
                }
            }
        },
        HttpqlOperator::Nin => match expected {
            HttpqlValue::List(list) => {
                if case_insensitive {
                    !list.iter().any(|item| item.eq_ignore_ascii_case(val))
                } else {
                    !list.iter().any(|item| item == val)
                }
            }
            _ => {
                let exp_str = val_as_string(expected);
                if case_insensitive {
                    !val.eq_ignore_ascii_case(&exp_str)
                } else {
                    val != exp_str
                }
            }
        },
        HttpqlOperator::Like => {
            if let Some(re) = compiled_regex {
                re.is_match(val)
            } else {
                let pattern = val_as_string(expected);
                if let Ok(re) = sql_like_to_regex(&pattern) {
                    re.is_match(val)
                } else {
                    val.to_lowercase().contains(&pattern.to_lowercase())
                }
            }
        }
        HttpqlOperator::Nlike => {
            if let Some(re) = compiled_regex {
                !re.is_match(val)
            } else {
                let pattern = val_as_string(expected);
                if let Ok(re) = sql_like_to_regex(&pattern) {
                    !re.is_match(val)
                } else {
                    !val.to_lowercase().contains(&pattern.to_lowercase())
                }
            }
        }
        HttpqlOperator::Regex => {
            if let Some(re) = compiled_regex {
                re.is_match(val)
            } else {
                let exp_str = val_as_string(expected);
                if let Ok(re) = Regex::new(&exp_str) {
                    re.is_match(val)
                } else {
                    val.contains(&exp_str)
                }
            }
        }
        HttpqlOperator::Nregex => {
            if let Some(re) = compiled_regex {
                !re.is_match(val)
            } else {
                let exp_str = val_as_string(expected);
                if let Ok(re) = Regex::new(&exp_str) {
                    !re.is_match(val)
                } else {
                    !val.contains(&exp_str)
                }
            }
        }
        HttpqlOperator::Gt => val_cmp > val_as_string(expected).to_lowercase(),
        HttpqlOperator::Ge => val_cmp >= val_as_string(expected).to_lowercase(),
        HttpqlOperator::Lt => val_cmp < val_as_string(expected).to_lowercase(),
        HttpqlOperator::Le => val_cmp <= val_as_string(expected).to_lowercase(),
    }
}

fn eval_num_cmp(val: i64, op: HttpqlOperator, expected: &HttpqlValue) -> bool {
    match op {
        HttpqlOperator::Eq => match expected {
            HttpqlValue::Number(n) => val == *n,
            HttpqlValue::List(list) => list.iter().any(|item| item.parse::<i64>().map(|n| n == val).unwrap_or(false)),
            _ => val_as_string(expected).parse::<i64>().map(|n| n == val).unwrap_or(false),
        },
        HttpqlOperator::Ne => match expected {
            HttpqlValue::Number(n) => val != *n,
            HttpqlValue::List(list) => !list.iter().any(|item| item.parse::<i64>().map(|n| n == val).unwrap_or(false)),
            _ => val_as_string(expected).parse::<i64>().map(|n| n != val).unwrap_or(false),
        },
        HttpqlOperator::Gt => val > val_as_num(expected),
        HttpqlOperator::Ge => val >= val_as_num(expected),
        HttpqlOperator::Lt => val < val_as_num(expected),
        HttpqlOperator::Le => val <= val_as_num(expected),
        HttpqlOperator::In => {
            let list = val_as_num_list(expected);
            list.contains(&val)
        }
        HttpqlOperator::Nin => {
            let list = val_as_num_list(expected);
            !list.contains(&val)
        }
        _ => true,
    }
}

fn eval_header_cmp(
    raw: &str,
    header_name: Option<&str>,
    op: HttpqlOperator,
    expected: &HttpqlValue,
    compiled_regex: Option<&Regex>,
) -> bool {
    let (head, _) = split_message(raw);
    let hname = match header_name {
        Some(name) => name.to_lowercase(),
        None => "".to_string(),
    };

    if hname.is_empty() {
        return eval_str_cmp(head, op, expected, true, compiled_regex);
    }

    for line in head.lines().skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case(&hname) {
                if eval_str_cmp(v.trim(), op, expected, true, compiled_regex) {
                    return true;
                }
            }
        }
    }
    false
}

fn sql_like_to_regex(pattern: &str) -> Result<Regex, regex::Error> {
    let mut re_str = String::from("(?i)^");
    for ch in pattern.chars() {
        match ch {
            '%' => re_str.push_str(".*"),
            '_' => re_str.push('.'),
            c if regex::escape(&c.to_string()) != c.to_string() => {
                re_str.push('\\');
                re_str.push(c);
            }
            c => re_str.push(c),
        }
    }
    re_str.push('$');
    Regex::new(&re_str)
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    struct MockRow {
        id: u32,
        method: String,
        host: String,
        path: String,
        query: Option<String>,
        extension: Option<String>,
        status_code: i64,
        response_length: i64,
        response_time_ms: i64,
        sent_at_ms: i64,
        state: String,
        is_https: bool,
        raw_request: String,
        raw_response: String,
    }

    impl HttpTransactionEvaluable for MockRow {
        fn eval_id(&self) -> u32 {
            self.id
        }
        fn eval_method(&self) -> &str {
            &self.method
        }
        fn eval_host(&self) -> &str {
            &self.host
        }
        fn eval_path(&self) -> &str {
            &self.path
        }
        fn eval_query(&self) -> Option<&str> {
            self.query.as_deref()
        }
        fn eval_ext(&self) -> Option<&str> {
            self.extension.as_deref()
        }
        fn eval_status_code(&self) -> i64 {
            self.status_code
        }
        fn eval_response_length(&self) -> i64 {
            self.response_length
        }
        fn eval_response_time_ms(&self) -> i64 {
            self.response_time_ms
        }
        fn eval_sent_at_ms(&self) -> i64 {
            self.sent_at_ms
        }
        fn eval_state(&self) -> &str {
            &self.state
        }
        fn eval_is_https(&self) -> bool {
            self.is_https
        }
        fn eval_raw_request(&self) -> Option<&str> {
            Some(&self.raw_request)
        }
        fn eval_raw_response(&self) -> Option<&str> {
            Some(&self.raw_response)
        }
    }

    #[test]
    fn test_parse_simple_equality() {
        let expr = parse_httpql("req.method:\"POST\"").unwrap().unwrap();
        assert_eq!(
            expr,
            HttpqlExpr::Condition(HttpqlCondition {
                field: HttpqlField::ReqMethod,
                op: HttpqlOperator::Eq,
                value: HttpqlValue::String("POST".to_string()),
                compiled_regex: None,
            })
        );
    }

    #[test]
    fn test_parse_modifiers_and_in() {
        let expr = parse_httpql("resp.code.ge:400 and req.ext.nin:[\"png\", \"jpg\"]").unwrap().unwrap();
        match expr {
            HttpqlExpr::And(items) => {
                assert_eq!(items.len(), 2);
                assert_eq!(
                    items[0],
                    HttpqlExpr::Condition(HttpqlCondition {
                        field: HttpqlField::RespCode,
                        op: HttpqlOperator::Ge,
                        value: HttpqlValue::Number(400),
                        compiled_regex: None,
                    })
                );
                assert_eq!(
                    items[1],
                    HttpqlExpr::Condition(HttpqlCondition {
                        field: HttpqlField::ReqExt,
                        op: HttpqlOperator::Nin,
                        value: HttpqlValue::List(vec!["png".to_string(), "jpg".to_string()]),
                        compiled_regex: None,
                    })
                );
            }
            _ => panic!("Expected AND expression"),
        }
    }

    #[test]
    fn test_parse_header_brackets() {
        let expr = parse_httpql("req.header[\"content-type\"].cont:\"json\"").unwrap().unwrap();
        assert_eq!(
            expr,
            HttpqlExpr::Condition(HttpqlCondition {
                field: HttpqlField::ReqHeader(Some("content-type".to_string())),
                op: HttpqlOperator::Cont,
                value: HttpqlValue::String("json".to_string()),
                compiled_regex: None,
            })
        );
    }

    #[test]
    fn test_parse_nested_parentheses() {
        let expr = parse_httpql("(req.method:\"GET\" or req.method:\"POST\") and resp.code:200").unwrap().unwrap();
        match expr {
            HttpqlExpr::And(items) => {
                assert_eq!(items.len(), 2);
                match &items[0] {
                    HttpqlExpr::Or(or_items) => {
                        assert_eq!(or_items.len(), 2);
                    }
                    _ => panic!("Expected OR sub-expression"),
                }
            }
            _ => panic!("Expected AND expression"),
        }
    }

    #[test]
    fn test_evaluate_in_memory() {
        let row = MockRow {
            id: 1,
            method: "POST".to_string(),
            host: "api.example.com".to_string(),
            path: "/v1/users".to_string(),
            query: Some("debug=true".to_string()),
            extension: Some("json".to_string()),
            status_code: 201,
            response_length: 1240,
            response_time_ms: 120,
            sent_at_ms: 1690000000000,
            state: "Success".to_string(),
            is_https: true,
            raw_request: "POST /v1/users HTTP/1.1\r\nHost: api.example.com\r\nAuthorization: Bearer token123\r\n\r\n{\"name\":\"alice\"}".to_string(),
            raw_response: "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\n\r\n{\"id\":1}".to_string(),
        };

        let q1 = parse_httpql("req.method:\"POST\" and resp.code.lt:300").unwrap().unwrap();
        assert!(q1.evaluate(&row));

        let q2 = parse_httpql("req.header[\"authorization\"].cont:\"Bearer\"").unwrap().unwrap();
        assert!(q2.evaluate(&row));

        let q3 = parse_httpql("resp.code.ge:400").unwrap().unwrap();
        assert!(!q3.evaluate(&row));

        let q4 = parse_httpql("req.host.cont:\"example\" and not req.method:\"GET\"").unwrap().unwrap();
        assert!(q4.evaluate(&row));

        let q5 = parse_httpql("req.ext.in:[\"json\", \"xml\"]").unwrap().unwrap();
        assert!(q5.evaluate(&row));

        let q6 = parse_httpql("req.host.like:\"%.example.%\"").unwrap().unwrap();
        assert!(q6.evaluate(&row));

        let q7 = parse_httpql("req.host.nlike:\"%google%\"").unwrap().unwrap();
        assert!(q7.evaluate(&row));

        let q8 = parse_httpql("req.path.regex:\"^/v[0-9]+/users\"").unwrap().unwrap();
        assert!(q8.evaluate(&row));

        let q9 = parse_httpql("req.path.nregex:\"^/admin\"").unwrap().unwrap();
        assert!(q9.evaluate(&row));

        let q10 = parse_httpql("row.id.eq:1").unwrap().unwrap();
        assert!(q10.evaluate(&row));

        let q11 = parse_httpql("req.created_at.gt:\"2023-01-01\"").unwrap().unwrap();
        assert!(q11.evaluate(&row));

        let q12 = parse_httpql("resp.roundtrip.lte:500").unwrap().unwrap();
        assert!(q12.evaluate(&row));

        let q13 = parse_httpql("/* multi-line comment */ req.ext.eq:\".json\" // single-line comment").unwrap().unwrap();
        assert!(q13.evaluate(&row));

        let q14 = parse_httpql("preset:\"hide-static\"").unwrap().unwrap();
        assert!(q14.evaluate(&row));

        let static_row = MockRow {
            id: 2,
            method: "GET".to_string(),
            host: "api.example.com".to_string(),
            path: "/assets/logo.png".to_string(),
            query: None,
            extension: Some("png".to_string()),
            status_code: 200,
            response_length: 5400,
            response_time_ms: 30,
            sent_at_ms: 1690000000000,
            state: "Success".to_string(),
            is_https: true,
            raw_request: "GET /assets/logo.png HTTP/1.1\r\nHost: api.example.com\r\n\r\n".to_string(),
            raw_response: "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\n\r\n".to_string(),
        };

        // Static row should NOT match hide-static filter
        assert!(!q14.evaluate(&static_row));

        let q15 = parse_httpql("req.ext.nin:[\"png\", \"jpg\", \"css\", \"js\"]").unwrap().unwrap();
        assert!(q15.evaluate(&row));
        assert!(!q15.evaluate(&static_row));

        let q16 = parse_httpql("req.ext.nin:[\".png\", \".jpg\", \".css\", \".js\"]").unwrap().unwrap();
        assert!(q16.evaluate(&row));
        assert!(!q16.evaluate(&static_row));
    }

    #[test]
    fn test_spaced_colon_syntax() {
        let q = parse_httpql("resp.code : 200").unwrap().unwrap();
        assert_eq!(
            q,
            HttpqlExpr::Condition(HttpqlCondition {
                field: HttpqlField::RespCode,
                op: HttpqlOperator::Eq,
                value: HttpqlValue::Number(200),
                compiled_regex: None,
            })
        );

        let q2 = parse_httpql("req.method : \"POST\"").unwrap().unwrap();
        assert_eq!(
            q2,
            HttpqlExpr::Condition(HttpqlCondition {
                field: HttpqlField::ReqMethod,
                op: HttpqlOperator::Eq,
                value: HttpqlValue::String("POST".to_string()),
                compiled_regex: None,
            })
        );
    }

    #[test]
    fn test_unknown_field_error() {
        let res = parse_httpql("req.reponse.code:200");
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Unknown HTTPQL field"));
    }

    #[test]
    fn test_unknown_preset_fallback() {
        let q = parse_httpql("preset:\"nonexistent_alias\"").unwrap().unwrap();
        let mut builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM http_history WHERE ");
        compile_httpql_to_sql(&mut builder, &q);
        assert_eq!(builder.sql(), "SELECT * FROM http_history WHERE 1=0");
    }

    #[test]
    fn test_header_content_type_cont_single_line() {
        let js_row = MockRow {
            id: 10,
            method: "GET".to_string(),
            host: "duckduckgo.com".to_string(),
            path: "/ac/".to_string(),
            query: None,
            extension: Some("js".to_string()),
            status_code: 200,
            response_length: 118,
            response_time_ms: 30,
            sent_at_ms: 1690000000000,
            state: "Success".to_string(),
            is_https: true,
            raw_request: "GET /ac/ HTTP/1.1\r\nHost: duckduckgo.com\r\n\r\n".to_string(),
            raw_response: "HTTP/1.1 200 OK\r\nContent-Type: application/javascript; charset=UTF-8\r\nContent-Disposition: attachment; filename=\"ac.json\"\r\n\r\n[\"json_data\"]".to_string(),
        };

        let json_row = MockRow {
            id: 11,
            method: "GET".to_string(),
            host: "duckduckgo.com".to_string(),
            path: "/api/status".to_string(),
            query: None,
            extension: Some("json".to_string()),
            status_code: 200,
            response_length: 50,
            response_time_ms: 20,
            sent_at_ms: 1690000000000,
            state: "Success".to_string(),
            is_https: true,
            raw_request: "GET /api/status HTTP/1.1\r\nHost: duckduckgo.com\r\n\r\n".to_string(),
            raw_response: "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{\"status\":\"ok\"}".to_string(),
        };

        let q = parse_httpql("resp.header[\"content-type\"].cont:\"json\"").unwrap().unwrap();

        // In-memory evaluation
        assert!(!q.evaluate(&js_row), "JS response Content-Type should not match json");
        assert!(q.evaluate(&json_row), "JSON response Content-Type should match json");

        // SQL compilation
        let mut builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM http_history WHERE ");
        compile_httpql_to_sql(&mut builder, &q);
        assert!(builder.sql().as_str().contains("INSTR(LOWER(raw_response)"), "SQL should extract single header line");
    }

    #[test]
    fn test_fuzzer_httpql_compilation() {
        // Test code, len, roundtrip
        let q = parse_httpql("resp.code:200 and resp.len.gt:500 and resp.roundtrip.lt:100").unwrap().unwrap();
        let mut builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE ");
        compile_fuzzer_httpql_to_sql(&mut builder, &q, None, None);
        let sql = builder.sql();
        assert!(sql.as_str().contains("status_code = ?"));
        assert!(sql.as_str().contains("response_length > ?"));
        assert!(sql.as_str().contains("response_time_ms < ?"));

        // Test FTS-accelerated functionality for header and raw
        let q_fts = parse_httpql("resp.header[\"server\"].cont:\"nginx\" and resp.raw.cont:\"error\"").unwrap().unwrap();
        let mut b2 = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE ");
        compile_fuzzer_httpql_to_sql(&mut b2, &q_fts, None, None);
        let sql2 = b2.sql();
        assert!(sql2.as_str().contains("chunk_id IN (SELECT rowid FROM fuzzer_chunks_fts WHERE fuzzer_chunks_fts MATCH ?"));

        // Test payload and bare search
        let q_payload = parse_httpql("payload.cont:\"admin\"").unwrap().unwrap();
        let mut b3 = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE ");
        compile_fuzzer_httpql_to_sql(&mut b3, &q_payload, None, None);
        assert!(b3.sql().as_str().contains("COALESCE(payload, '') LIKE ?"));

        let q_bare = parse_httpql("foo").unwrap().unwrap();
        let mut b4 = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE ");
        compile_fuzzer_httpql_to_sql(&mut b4, &q_bare, None, None);
        assert!(b4.sql().as_str().contains("COALESCE(payload, '') LIKE ?"));
        assert!(b4.sql().as_str().contains("chunk_id IN (SELECT rowid FROM fuzzer_chunks_fts"));

        // Test FuzzerEvaluableItem with in-memory evaluation
        let item = FuzzerEvaluableItem {
            id: 1,
            method: "GET",
            host: "example.com",
            path: "/test",
            query: None,
            ext: None,
            status_code: 200,
            response_length: 50,
            response_time_ms: 25,
            sent_at_ms: 1000,
            state: "completed",
            is_https: false,
            raw_request: None,
            raw_response: Some("HTTP/1.1 200 OK\r\nServer: nginx\r\n\r\n{\"flag\":\"secret_123\"}"),
            payload: Some("fuzz_target"),
        };

        let q_eval = parse_httpql("resp.code:200 and resp.header[\"server\"].cont:\"nginx\" and resp.body.cont:\"secret_123\" and payload:\"fuzz_target\"").unwrap().unwrap();
        assert!(q_eval.evaluate(&item));
    }

    #[test]
    fn test_ast_simplification() {
        // Double negation
        let expr1 = parse_httpql("not not resp.code:200").unwrap().unwrap();
        assert_eq!(
            expr1,
            HttpqlExpr::Condition(HttpqlCondition {
                field: HttpqlField::RespCode,
                op: HttpqlOperator::Eq,
                value: HttpqlValue::Number(200),
                compiled_regex: None,
            })
        );

        // Same-operator flattening: A and (B and C) -> A and B and C
        let expr2 = parse_httpql("resp.code:200 and (resp.len:100 and resp.time:50)").unwrap().unwrap();
        match expr2 {
            HttpqlExpr::And(items) => {
                assert_eq!(items.len(), 3);
            }
            _ => panic!("Expected flattened AND with 3 items"),
        }

        // Same-operator flattening: A or (B or C) -> A or B or C
        let expr3 = parse_httpql("resp.code:200 or (resp.code:404 or resp.code:500)").unwrap().unwrap();
        match expr3 {
            HttpqlExpr::Or(items) => {
                assert_eq!(items.len(), 3);
            }
            _ => panic!("Expected flattened OR with 3 items"),
        }
    }

    #[test]
    fn test_cost_ordering_and_precompiled_regex() {
        let mut expr = parse_httpql("resp.body.regex:\"error.*\" and resp.code:200 and req.header[\"user-agent\"]:\"Mozilla\"").unwrap().unwrap();
        // Verify precompiled regex exists
        match &expr {
            HttpqlExpr::And(items) => {
                match &items[0] {
                    HttpqlExpr::Condition(c) => assert!(c.compiled_regex.is_some(), "Regex must be precompiled"),
                    _ => panic!("Expected condition"),
                }
            }
            _ => panic!("Expected AND"),
        }

        // Optimize evaluation order: cheapest first (resp.code: 1, req.header: 15, regex: 500)
        expr.optimize_evaluation_order();
        match &expr {
            HttpqlExpr::And(items) => {
                assert_eq!(items.len(), 3);
                match &items[0] {
                    HttpqlExpr::Condition(c) => assert_eq!(c.field, HttpqlField::RespCode),
                    _ => panic!("First item should be RespCode"),
                }
                match &items[1] {
                    HttpqlExpr::Condition(c) => assert!(matches!(c.field, HttpqlField::ReqHeader(_))),
                    _ => panic!("Second item should be ReqHeader"),
                }
                match &items[2] {
                    HttpqlExpr::Condition(c) => assert_eq!(c.field, HttpqlField::RespBody),
                    _ => panic!("Third item should be RespBody regex"),
                }
            }
            _ => panic!("Expected AND"),
        }
    }

    #[test]
    fn test_fuzzer_sql_pushdown_soundness() {
        // 1. Negated FTS: must emit 1=1 instead of dropping chunks
        let q_neg_fts = parse_httpql("not resp.raw.cont:\"error\"").unwrap().unwrap();
        let mut b1 = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE ");
        compile_fuzzer_httpql_to_sql(&mut b1, &q_neg_fts, None, None);
        assert_eq!(b1.sql(), "SELECT * FROM fuzzer_requests WHERE 1=1");

        // 2. Negated exact column: must emit NOT (status_code = ?)
        let q_neg_exact = parse_httpql("not resp.code:404").unwrap().unwrap();
        let mut b2 = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE ");
        compile_fuzzer_httpql_to_sql(&mut b2, &q_neg_exact, None, None);
        assert!(b2.sql().as_str().contains("NOT (status_code = ?)"));

        // 3. OR pushdown with unconstrained branch: must emit 1=1
        let q_or_unconstrained = parse_httpql("resp.code:200 or resp.header[\"server\"].regex:\"nginx.*\"").unwrap().unwrap();
        let mut b3 = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE ");
        compile_fuzzer_httpql_to_sql(&mut b3, &q_or_unconstrained, None, None);
        assert_eq!(b3.sql(), "SELECT * FROM fuzzer_requests WHERE 1=1");

        // 4. OR pushdown with exact branches: must emit (status_code = ? OR status_code = ?)
        let q_or_exact = parse_httpql("resp.code:200 or resp.code:404").unwrap().unwrap();
        let mut b4 = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE ");
        compile_fuzzer_httpql_to_sql(&mut b4, &q_or_exact, None, None);
        assert!(b4.sql().as_str().contains("status_code = ? OR status_code = ?"));

        // 5. AND with exact column and negated FTS: exact column pushes down, negated FTS emits 1=1
        let q_and_mixed = parse_httpql("resp.code:200 and not resp.body.cont:\"secret\"").unwrap().unwrap();
        let mut b5 = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE ");
        compile_fuzzer_httpql_to_sql(&mut b5, &q_and_mixed, None, None);
        assert!(b5.sql().as_str().contains("status_code = ? AND 1=1"));
    }
}
