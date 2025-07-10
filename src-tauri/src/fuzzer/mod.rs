// use serde::{Deserialize, Serialize};

use crate::structs::{FuzzerParameter, FuzzerPayload};

use crate::http_request;

use http_request::http_request;

// use http_request::http_request;

#[derive(Debug, Clone)]
pub struct GeneratedPayload {
    pub raw_request: String,
    pub parameter_combinations: Vec<(String, String)>, // (parameter_name, used_value)
}

pub struct FuzzerIterator {
    raw_request: String,
    parameters: Vec<FuzzerParameter>,
    current_indices: Vec<usize>,
    finished: bool,
}

impl FuzzerIterator {
    fn new(payload: &FuzzerPayload) -> Self {
        let finished =
            payload.parameters.is_empty() || payload.parameters.iter().any(|p| p.values.is_empty());

        Self {
            raw_request: payload.raw_request.clone(),
            parameters: payload.parameters.clone(),
            current_indices: vec![0; payload.parameters.len()],
            finished,
        }
    }

    /// Get the total number of combinations that will be generated
    pub fn total_combinations(&self) -> usize {
        if self.parameters.is_empty() {
            return 1;
        }

        self.parameters.iter().map(|p| p.values.len()).product()
    }

    /// Get the current combination index (0-based)
    pub fn current_index(&self) -> usize {
        if self.parameters.is_empty() {
            return 0;
        }

        let mut index = 0;
        let mut multiplier = 1;

        for i in (0..self.parameters.len()).rev() {
            index += self.current_indices[i] * multiplier;
            multiplier *= self.parameters[i].values.len();
        }

        index
    }

    fn increment_indices(&mut self) -> bool {
        if self.parameters.is_empty() {
            self.finished = true;
            return false;
        }

        // Increment from rightmost index (little-endian style)
        for i in (0..self.current_indices.len()).rev() {
            self.current_indices[i] += 1;
            if self.current_indices[i] < self.parameters[i].values.len() {
                return true; // Successfully incremented
            }
            self.current_indices[i] = 0; // Reset and carry over
        }

        // All indices have rolled over, we're done
        self.finished = true;
        false
    }

    fn generate_current_payload(&self) -> GeneratedPayload {
        let mut modified_request = self.raw_request.clone();
        let mut param_combinations = Vec::new();

        for (i, param) in self.parameters.iter().enumerate() {
            let value = &param.values[self.current_indices[i]];
            let placeholder = format!("{{{{{}}}}}", param.name);
            modified_request = modified_request.replace(&placeholder, value);
            param_combinations.push((param.name.clone(), value.clone()));
        }

        GeneratedPayload {
            raw_request: modified_request,
            parameter_combinations: param_combinations,
        }
    }
}

impl Iterator for FuzzerIterator {
    type Item = GeneratedPayload;

    fn next(&mut self) -> Option<Self::Item> {
        if self.finished {
            return None;
        }

        let payload = self.generate_current_payload();

        // Prepare for next iteration
        if self.parameters.is_empty() {
            self.finished = true;
        } else {
            self.increment_indices();
        }

        Some(payload)
    }
}

impl FuzzerPayload {
    /// Create an iterator that generates combinations lazily
    pub fn iter_combinations(&self) -> FuzzerIterator {
        FuzzerIterator::new(self)
    }

    /// Get the total number of combinations without generating them
    pub fn count_combinations(&self) -> usize {
        if self.parameters.is_empty() {
            return 1;
        }

        self.parameters.iter().map(|p| p.values.len()).product()
    }
}

pub struct FuzzerResult {
    pub raw_response: String,
    pub response_time: u64,
    pub parameter_combinations: Vec<(String, String)>, // Track which combination was used
}

// Corrected fuzzing function that tests all combinations
pub fn fuzzing(payload: FuzzerPayload) -> Vec<FuzzerResult> {
    let mut results = Vec::new();

    println!(
        "Starting fuzzing with {} total combinations",
        payload.count_combinations()
    );

    for (i, combination) in payload.iter_combinations().enumerate() {
        // println!(
        //     "Testing combination {}: {:?}",
        //     i + 1,
        //     combination.parameter_combinations
        // );
        // println!("Modified request: \n{}", combination.raw_request);

        let raw_response = http_request(&combination.raw_request, &payload.metadata.target_url)
            .unwrap_or_else(|_| String::new());

        let response_time = 100 + (i as u64 * 10); // Example response time

        let result = FuzzerResult {
            raw_response,
            response_time,
            parameter_combinations: combination.parameter_combinations,
        };

        results.push(result);
    }

    results
}
