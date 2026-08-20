use crate::types::match_replace::{MatchReplaceCollection, MatchReplaceData, MatchReplaceRule};
use sqlx::SqlitePool;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Seeds the default dummy Match & Replace collections and rules for a new project.
/// All rules are disabled (enabled = 0) and in-scope (only_in_scope = 1).
pub async fn seed_default_match_replace_rules(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<(), String> {
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM match_replace_collections WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count match_replace_collections: {e}"))?;

    if count.0 > 0 {
        return Ok(());
    }

    let now = now_ms();

    // Collection 1: Default Proxy Rules
    let col1_id = format!("col-def-{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO match_replace_collections (id, project_id, name, created_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(&col1_id)
    .bind(project_id)
    .bind("Default Proxy Rules")
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to insert default collection 1: {e}"))?;

    // Rules for Collection 1
    insert_rule(
        pool,
        project_id,
        &col1_id,
        "Strip Accept-Encoding (gzip)",
        "request_header",
        "Accept-Encoding: gzip, deflate, br",
        "Accept-Encoding: identity",
        "Prevent server from returning compressed response so body can be easily inspected.",
        false,
        false,
        true,
        0,
    )
    .await?;

    insert_rule(
        pool,
        project_id,
        &col1_id,
        "Inject Test Auth Token",
        "request_header",
        "Authorization: Bearer .*",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_admin_token",
        "Automatically replaces incoming Bearer token with the elevated testing JWT.",
        true,
        false,
        true,
        1,
    )
    .await?;

    insert_rule(
        pool,
        project_id,
        &col1_id,
        "Elevate Role Parameter",
        "request_param_value",
        "role=user",
        "role=admin",
        "Replaces query parameter role=user with role=admin to test parameter privilege escalation.",
        false,
        false,
        true,
        2,
    )
    .await?;

    insert_rule(
        pool,
        project_id,
        &col1_id,
        "Query Param Name (debug -> verbose)",
        "request_param_name",
        "debug=0",
        "verbose=1",
        "Rewrites query parameter name from debug to verbose.",
        false,
        false,
        true,
        3,
    )
    .await?;

    // Collection 2: Security Header Modification
    let col2_id = format!("col-sec-{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO match_replace_collections (id, project_id, name, created_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(&col2_id)
    .bind(project_id)
    .bind("Security Header Modification")
    .bind(now + 1)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to insert default collection 2: {e}"))?;

    insert_rule(
        pool,
        project_id,
        &col2_id,
        "Remove CSP Header",
        "response_header",
        "Content-Security-Policy: .*",
        "",
        "Strips Content-Security-Policy from responses to facilitate client-side testing.",
        true,
        false,
        true,
        0,
    )
    .await?;

    insert_rule(
        pool,
        project_id,
        &col2_id,
        "Bypass JSON isAdmin Body Flag",
        "request_body",
        "\"isAdmin\": false",
        "\"isAdmin\": true",
        "Modifies JSON request payload to set isAdmin flag to true.",
        false,
        false,
        true,
        1,
    )
    .await?;

    insert_rule(
        pool,
        project_id,
        &col2_id,
        "Response Body Access Granted",
        "response_body",
        "\"access\": \"denied\"",
        "\"access\": \"granted\"",
        "Modifies response body access flag from denied to granted.",
        false,
        false,
        true,
        2,
    )
    .await?;

    // Collection 3: Client Emulation & Routing
    let col3_id = format!("col-emu-{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO match_replace_collections (id, project_id, name, created_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(&col3_id)
    .bind(project_id)
    .bind("Client Emulation & Routing")
    .bind(now + 2)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to insert default collection 3: {e}"))?;

    insert_rule(
        pool,
        project_id,
        &col3_id,
        "Emulate Mobile Safari UA",
        "request_header",
        "User-Agent: .*",
        "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        "Replaces desktop User-Agent with iPhone Safari User-Agent.",
        true,
        false,
        true,
        0,
    )
    .await?;

    insert_rule(
        pool,
        project_id,
        &col3_id,
        "Rewrite First Line Method/Path",
        "request_first_line",
        "POST /api/v1/user/profile",
        "POST /api/v1/admin/dashboard",
        "Transforms the HTTP request method and path in the first line.",
        false,
        false,
        true,
        1,
    )
    .await?;

    Ok(())
}

async fn insert_rule(
    pool: &SqlitePool,
    project_id: &str,
    collection_id: &str,
    name: &str,
    rule_type: &str,
    match_pattern: &str,
    replace_pattern: &str,
    comment: &str,
    is_regex: bool,
    is_case_sensitive: bool,
    only_in_scope: bool,
    sort_order: i64,
) -> Result<(), String> {
    let id = format!("rule-{}", Uuid::new_v4());
    let now = now_ms();
    sqlx::query(
        "INSERT INTO match_replace_rules (
            id, collection_id, project_id, name, enabled, rule_type, match_pattern, replace_pattern, comment, is_regex, is_case_sensitive, only_in_scope, sort_order, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    )
    .bind(&id)
    .bind(collection_id)
    .bind(project_id)
    .bind(name)
    .bind(0) // enabled = 0 (disabled by default)
    .bind(rule_type)
    .bind(match_pattern)
    .bind(replace_pattern)
    .bind(comment)
    .bind(if is_regex { 1 } else { 0 })
    .bind(if is_case_sensitive { 1 } else { 0 })
    .bind(if only_in_scope { 1 } else { 0 })
    .bind(sort_order)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to insert rule {name}: {e}"))?;

    Ok(())
}

/// Retrieves all Match & Replace collections and rules for a project.
pub async fn get_match_replace_data(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<MatchReplaceData, String> {
    // Ensure project has default rules seeded
    seed_default_match_replace_rules(pool, project_id).await?;

    let col_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, name FROM match_replace_collections WHERE project_id = $1 ORDER BY created_at ASC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load match_replace_collections: {e}"))?;

    let rule_rows: Vec<(
        String, // id
        String, // collection_id
        String, // name
        i64,    // enabled
        String, // rule_type
        String, // match_pattern
        String, // replace_pattern
        String, // comment
        i64,    // is_regex
        i64,    // is_case_sensitive
        i64,    // only_in_scope
    )> = sqlx::query_as(
        "SELECT id, collection_id, name, enabled, rule_type, match_pattern, replace_pattern, comment, is_regex, is_case_sensitive, only_in_scope
         FROM match_replace_rules
         WHERE project_id = $1
         ORDER BY sort_order ASC, created_at ASC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load match_replace_rules: {e}"))?;

    let mut collections = Vec::new();
    for (col_id, col_name) in col_rows {
        let rules = rule_rows
            .iter()
            .filter(|r| r.1 == col_id)
            .map(|r| MatchReplaceRule {
                id: r.0.clone(),
                name: r.2.clone(),
                enabled: r.3 != 0,
                rule_type: r.4.clone(),
                match_pattern: r.5.clone(),
                replace: r.6.clone(),
                comment: r.7.clone(),
                is_regex: Some(r.8 != 0),
                is_case_sensitive: Some(r.9 != 0),
                only_in_scope: Some(r.10 != 0),
            })
            .collect();

        collections.push(MatchReplaceCollection {
            id: col_id,
            name: col_name,
            rules,
        });
    }

    Ok(MatchReplaceData { collections })
}

pub async fn save_match_replace_collection(
    pool: &SqlitePool,
    project_id: &str,
    collection_id: &str,
    name: &str,
) -> Result<(), String> {
    let now = now_ms();
    sqlx::query(
        "INSERT INTO match_replace_collections (id, project_id, name, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = $3",
    )
    .bind(collection_id)
    .bind(project_id)
    .bind(name)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to save match_replace_collection: {e}"))?;

    Ok(())
}

pub async fn save_match_replace_rule(
    pool: &SqlitePool,
    project_id: &str,
    collection_id: &str,
    rule: &MatchReplaceRule,
) -> Result<(), String> {
    let now = now_ms();
    sqlx::query(
        "INSERT INTO match_replace_rules (
            id, collection_id, project_id, name, enabled, rule_type, match_pattern, replace_pattern, comment, is_regex, is_case_sensitive, only_in_scope, sort_order, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, $13)
        ON CONFLICT (id) DO UPDATE SET
            collection_id = $2,
            name = $4,
            enabled = $5,
            rule_type = $6,
            match_pattern = $7,
            replace_pattern = $8,
            comment = $9,
            is_regex = $10,
            is_case_sensitive = $11,
            only_in_scope = $12",
    )
    .bind(&rule.id)
    .bind(collection_id)
    .bind(project_id)
    .bind(&rule.name)
    .bind(if rule.enabled { 1 } else { 0 })
    .bind(&rule.rule_type)
    .bind(&rule.match_pattern)
    .bind(&rule.replace)
    .bind(&rule.comment)
    .bind(if rule.is_regex.unwrap_or(false) { 1 } else { 0 })
    .bind(if rule.is_case_sensitive.unwrap_or(false) { 1 } else { 0 })
    .bind(if rule.only_in_scope.unwrap_or(true) { 1 } else { 0 })
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to save match_replace_rule: {e}"))?;

    Ok(())
}

pub async fn toggle_match_replace_rule(
    pool: &SqlitePool,
    project_id: &str,
    rule_id: &str,
    enabled: bool,
) -> Result<(), String> {
    sqlx::query("UPDATE match_replace_rules SET enabled = $1 WHERE id = $2 AND project_id = $3")
        .bind(if enabled { 1 } else { 0 })
        .bind(rule_id)
        .bind(project_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to toggle match_replace_rule: {e}"))?;

    Ok(())
}

pub async fn delete_match_replace_rule(
    pool: &SqlitePool,
    project_id: &str,
    rule_id: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM match_replace_rules WHERE id = $1 AND project_id = $2")
        .bind(rule_id)
        .bind(project_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to delete match_replace_rule: {e}"))?;

    Ok(())
}

pub async fn delete_match_replace_collection(
    pool: &SqlitePool,
    project_id: &str,
    collection_id: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM match_replace_collections WHERE id = $1 AND project_id = $2")
        .bind(collection_id)
        .bind(project_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to delete match_replace_collection: {e}"))?;

    Ok(())
}
