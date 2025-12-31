use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use crate::{
    http_request::HttpConnection,
    types::{FuzzerParameter, FuzzerSession, HighlightRange, ReqRes},
};

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

pub async fn execute_rotator_fuzzing(session: &FuzzerSession, num_tasks: usize) -> Vec<ReqRes> {
    let results = Arc::new(Mutex::new(Vec::new()));
    let mut handles = vec![];
    let mut requests = Vec::new();

    // ROTATOR: Use first parameter's values, fuzz one position at a time
    if let Some(first_param) = session.payload.parameters.first() {
        for param in &session.payload.parameters {
            for value in &first_param.values {
                let modified_request = building_raw_request(
                    &session.payload.raw_request,
                    value,
                    &param.highlight_range,
                );
                requests.push(modified_request);
            }
        }
    }

    // Split work across tasks
    let chunk_size = (requests.len() + num_tasks - 1) / num_tasks;

    for chunk in requests.chunks(chunk_size) {
        let chunk = chunk.to_vec();
        let url = session.payload.metadata.target_url.clone();
        let results = Arc::clone(&results);
        let delay = session.payload.delais_time.clone(); // Clone the delay for this task

        let handle = tokio::spawn(async move {
            let mut conn = match HttpConnection::new(&url).await {
                Ok(conn) => conn,
                Err(e) => {
                    eprintln!("Connection failed: {}", e);
                    return;
                }
            };

            for modified_request in chunk {
                match conn.send_request(&modified_request).await {
                    Ok((response, response_time)) => {
                        let req_res = ReqRes {
                            request: modified_request.clone(),
                            response: response.clone(),
                            response_time: response_time.as_millis(),
                        };
                        results.lock().await.push(req_res);
                    }
                    Err(e) => eprintln!("Request failed: {}", e),
                }

                if delay > 0 {
                    sleep(Duration::from_millis(delay)).await;
                }
            }
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        handle.await.unwrap();
    }

    // Extract and return results
    Arc::try_unwrap(results).unwrap().into_inner()
}

pub async fn execute_echo_fuzzing(session: &FuzzerSession, num_tasks: usize) -> Vec<ReqRes> {
    let results = Arc::new(Mutex::new(Vec::new()));
    let mut handles = vec![];
    let mut requests = Vec::new();
    let delay = session.payload.delais_time.clone(); // Clone the delay for this task

    // ECHO: Use first parameter's values, apply same value to ALL positions simultaneously
    if let Some(first_param) = session.payload.parameters.first() {
        for value in &first_param.values {
            // Replace all parameters with the same value (in REVERSE order)
            let mut modified_request = session.payload.raw_request.clone();
            let mut sorted_params: Vec<_> = session.payload.parameters.iter().collect();

            // Sort by position (descending) so we replace from end to start
            sorted_params.sort_by(|a, b| b.highlight_range.from.cmp(&a.highlight_range.from));

            for param in sorted_params {
                modified_request =
                    building_raw_request(&modified_request, value, &param.highlight_range);
            }
            requests.push(modified_request);
        }
    }

    // Split work across tasks
    let chunk_size = (requests.len() + num_tasks - 1) / num_tasks;

    for chunk in requests.chunks(chunk_size) {
        let chunk = chunk.to_vec();
        let url = session.payload.metadata.target_url.clone();
        let results = Arc::clone(&results);

        let handle = tokio::spawn(async move {
            let mut conn = match HttpConnection::new(&url).await {
                Ok(conn) => conn,
                Err(e) => {
                    eprintln!("Connection failed: {}", e);
                    return;
                }
            };

            for modified_request in chunk {
                match conn.send_request(&modified_request).await {
                    Ok((response, response_time)) => {
                        let req_res = ReqRes {
                            request: modified_request.clone(),
                            response: response.clone(),
                            response_time: response_time.as_millis(),
                        };
                        results.lock().await.push(req_res);
                    }
                    Err(e) => eprintln!("Request failed: {}", e),
                }

                if delay > 0 {
                    sleep(Duration::from_millis(delay)).await;
                }
            }
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        handle.await.unwrap();
    }

    // Extract and return results
    Arc::try_unwrap(results).unwrap().into_inner()
}

pub async fn execute_zipped_fuzzing(session: &FuzzerSession, num_tasks: usize) -> Vec<ReqRes> {
    let results = Arc::new(Mutex::new(Vec::new()));
    let mut handles = vec![];
    let mut requests = Vec::new();
    let delay = session.payload.delais_time.clone(); // Clone the delay for this task

    // PITCHFORK: Iterate through all parameters simultaneously
    // Stop when the shortest parameter list is exhausted
    if !session.payload.parameters.is_empty() {
        // Find the minimum length across all parameter value lists
        let min_length = session
            .payload
            .parameters
            .iter()
            .map(|p| p.values.len())
            .min()
            .unwrap_or(0);

        // Iterate up to the shortest list
        for i in 0..min_length {
            let mut modified_request = session.payload.raw_request.clone();

            // Sort parameters by position (descending) to replace from end to start
            let mut sorted_params: Vec<_> = session.payload.parameters.iter().collect();
            sorted_params.sort_by(|a, b| b.highlight_range.from.cmp(&a.highlight_range.from));

            // Replace each parameter with its corresponding value at index i
            for param in sorted_params {
                let value = &param.values[i];
                modified_request =
                    building_raw_request(&modified_request, value, &param.highlight_range);
            }
            requests.push(modified_request);
        }
    }

    // Split work across tasks
    let chunk_size = (requests.len() + num_tasks - 1) / num_tasks;
    for chunk in requests.chunks(chunk_size) {
        let chunk = chunk.to_vec();
        let url = session.payload.metadata.target_url.clone();
        let results = Arc::clone(&results);

        let handle = tokio::spawn(async move {
            let mut conn = match HttpConnection::new(&url).await {
                Ok(conn) => conn,
                Err(e) => {
                    eprintln!("Connection failed: {}", e);
                    return;
                }
            };

            for modified_request in chunk {
                match conn.send_request(&modified_request).await {
                    Ok((response, response_time)) => {
                        let req_res = ReqRes {
                            request: modified_request.clone(),
                            response: response.clone(),
                            response_time: response_time.as_millis(),
                        };
                        results.lock().await.push(req_res);
                    }
                    Err(e) => eprintln!("Request failed: {}", e),
                }

                if delay > 0 {
                    sleep(Duration::from_millis(delay)).await;
                }
            }
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        handle.await.unwrap();
    }

    // Extract and return results
    Arc::try_unwrap(results).unwrap().into_inner()
}

pub async fn execute_combinatorial_fuzzing(
    session: &FuzzerSession,
    num_tasks: usize,
) -> Vec<ReqRes> {
    let results = Arc::new(Mutex::new(Vec::new()));
    let mut handles = vec![];
    let mut requests = Vec::new();
    let delay = session.payload.delais_time.clone(); // Clone the delay for this task

    // CLUSTER BOMB: Test every possible combination of all parameter values
    // This creates a cartesian product of all parameter value lists
    if !session.payload.parameters.is_empty() {
        // Generate all combinations using cartesian product
        let combinations = generate_combinations(&session.payload.parameters);

        for combination in combinations {
            let mut modified_request = session.payload.raw_request.clone();

            // Sort parameters by position (descending) to replace from end to start
            let mut sorted_params: Vec<_> = session.payload.parameters.iter().enumerate().collect();
            sorted_params.sort_by(|a, b| b.1.highlight_range.from.cmp(&a.1.highlight_range.from));

            // Replace each parameter with its value from the combination
            for (param_idx, param) in sorted_params {
                let value = &combination[param_idx];
                modified_request =
                    building_raw_request(&modified_request, value, &param.highlight_range);
            }
            requests.push(modified_request);
        }
    }

    // Split work across tasks
    let chunk_size = (requests.len() + num_tasks - 1) / num_tasks;
    for chunk in requests.chunks(chunk_size) {
        let chunk = chunk.to_vec();
        let url = session.payload.metadata.target_url.clone();
        let results = Arc::clone(&results);

        let handle = tokio::spawn(async move {
            let mut conn = match HttpConnection::new(&url).await {
                Ok(conn) => conn,
                Err(e) => {
                    eprintln!("Connection failed: {}", e);
                    return;
                }
            };

            for modified_request in chunk {
                match conn.send_request(&modified_request).await {
                    Ok((response, response_time)) => {
                        let req_res = ReqRes {
                            request: modified_request.clone(),
                            response: response.clone(),
                            response_time: response_time.as_millis(),
                        };
                        results.lock().await.push(req_res);
                    }
                    Err(e) => eprintln!("Request failed: {}", e),
                }

                if delay > 0 {
                    sleep(Duration::from_millis(delay)).await;
                }
            }
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        handle.await.unwrap();
    }

    // Extract and return results
    Arc::try_unwrap(results).unwrap().into_inner()
}

// Helper function to generate cartesian product of all parameter values
fn generate_combinations(parameters: &[FuzzerParameter]) -> Vec<Vec<String>> {
    if parameters.is_empty() {
        return vec![vec![]];
    }

    let mut result = vec![vec![]];

    for param in parameters {
        let mut new_result = Vec::new();

        for existing_combination in &result {
            for value in &param.values {
                let mut new_combination = existing_combination.clone();
                new_combination.push(value.clone());
                new_result.push(new_combination);
            }
        }

        result = new_result;
    }

    result
}
