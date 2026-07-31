use std::sync::atomic::{AtomicU32, Ordering};

pub struct HistoryIdCounter(AtomicU32);

impl HistoryIdCounter {
    pub fn new() -> Self {
        Self(AtomicU32::new(0))
    }

    pub fn next(&self) -> u32 {
        self.0.fetch_add(1, Ordering::Relaxed)
    }
}
