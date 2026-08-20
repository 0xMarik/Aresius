use crate::ares_utils::database::match_replace as db_mr;
use crate::ares_utils::database::DbState;
use crate::proxy::match_replace::MatchReplaceEngine;
use crate::types::match_replace::{MatchReplaceData, MatchReplaceRule};
use tauri::State;

#[tauri::command]
pub async fn get_match_replace(
    project_id: String,
    db_state: State<'_, DbState>,
    engine: State<'_, MatchReplaceEngine>,
) -> Result<MatchReplaceData, String> {
    let pool = db_state.pool().await?;
    let data = db_mr::get_match_replace_data(&pool, &project_id).await?;

    let all_rules: Vec<MatchReplaceRule> = data
        .collections
        .iter()
        .flat_map(|c| c.rules.clone())
        .collect();

    engine.update_rules(&all_rules).await;

    Ok(data)
}

#[tauri::command]
pub async fn save_match_replace_rule(
    project_id: String,
    collection_id: String,
    rule: MatchReplaceRule,
    db_state: State<'_, DbState>,
    engine: State<'_, MatchReplaceEngine>,
) -> Result<(), String> {
    let pool = db_state.pool().await?;
    db_mr::save_match_replace_rule(&pool, &project_id, &collection_id, &rule).await?;

    // Refresh engine rules
    if let Ok(data) = db_mr::get_match_replace_data(&pool, &project_id).await {
        let all_rules: Vec<MatchReplaceRule> = data
            .collections
            .iter()
            .flat_map(|c| c.rules.clone())
            .collect();
        engine.update_rules(&all_rules).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_match_replace_rule(
    project_id: String,
    rule_id: String,
    enabled: bool,
    db_state: State<'_, DbState>,
    engine: State<'_, MatchReplaceEngine>,
) -> Result<(), String> {
    let pool = db_state.pool().await?;
    db_mr::toggle_match_replace_rule(&pool, &project_id, &rule_id, enabled).await?;

    // Refresh engine rules
    if let Ok(data) = db_mr::get_match_replace_data(&pool, &project_id).await {
        let all_rules: Vec<MatchReplaceRule> = data
            .collections
            .iter()
            .flat_map(|c| c.rules.clone())
            .collect();
        engine.update_rules(&all_rules).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_match_replace_rule(
    project_id: String,
    rule_id: String,
    db_state: State<'_, DbState>,
    engine: State<'_, MatchReplaceEngine>,
) -> Result<(), String> {
    let pool = db_state.pool().await?;
    db_mr::delete_match_replace_rule(&pool, &project_id, &rule_id).await?;

    // Refresh engine rules
    if let Ok(data) = db_mr::get_match_replace_data(&pool, &project_id).await {
        let all_rules: Vec<MatchReplaceRule> = data
            .collections
            .iter()
            .flat_map(|c| c.rules.clone())
            .collect();
        engine.update_rules(&all_rules).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn save_match_replace_collection(
    project_id: String,
    collection_id: String,
    name: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let pool = db_state.pool().await?;
    db_mr::save_match_replace_collection(&pool, &project_id, &collection_id, &name).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_match_replace_collection(
    project_id: String,
    collection_id: String,
    db_state: State<'_, DbState>,
    engine: State<'_, MatchReplaceEngine>,
) -> Result<(), String> {
    let pool = db_state.pool().await?;
    db_mr::delete_match_replace_collection(&pool, &project_id, &collection_id).await?;

    // Refresh engine rules
    if let Ok(data) = db_mr::get_match_replace_data(&pool, &project_id).await {
        let all_rules: Vec<MatchReplaceRule> = data
            .collections
            .iter()
            .flat_map(|c| c.rules.clone())
            .collect();
        engine.update_rules(&all_rules).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn sync_match_replace_engine(
    rules: Vec<MatchReplaceRule>,
    engine: State<'_, MatchReplaceEngine>,
) -> Result<(), String> {
    engine.update_rules(&rules).await;
    Ok(())
}
