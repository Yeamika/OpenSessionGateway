//! Timer store for managing timer state and scheduling.
//!
//! Thread-safe in-memory store. One-shot timers are removed after drain.
//! Periodic/cron are not supported in this phase.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Timer type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimerType {
    OneShot,
    Periodic,
    Cron,
}

impl std::fmt::Display for TimerType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TimerType::OneShot => write!(f, "one_shot"),
            TimerType::Periodic => write!(f, "periodic"),
            TimerType::Cron => write!(f, "cron"),
        }
    }
}

/// Timer status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimerStatus {
    Pending,
    Fired,
    Deleted,
}

impl std::fmt::Display for TimerStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TimerStatus::Pending => write!(f, "pending"),
            TimerStatus::Fired => write!(f, "fired"),
            TimerStatus::Deleted => write!(f, "deleted"),
        }
    }
}

/// Timer data structure — field names match TypeScript wire format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Timer {
    #[serde(rename = "TimerID")]
    pub timer_id: String,
    #[serde(rename = "RuntimeID")]
    pub runtime_id: String,
    #[serde(rename = "SessionID")]
    pub session_id: String,
    #[serde(rename = "ExecutorRuntimeID")]
    pub executor_runtime_id: String,
    #[serde(rename = "ExecutorSessionID")]
    pub executor_session_id: String,
    #[serde(rename = "Title")]
    pub title: String,
    #[serde(rename = "MSG")]
    pub msg: String,
    #[serde(rename = "TimerType")]
    pub timer_type: TimerType,
    #[serde(rename = "DelaySeconds")]
    pub delay_seconds: u64,
    #[serde(rename = "EverySeconds", skip_serializing_if = "Option::is_none")]
    pub every_seconds: Option<u64>,
    #[serde(rename = "CronExpr", skip_serializing_if = "Option::is_none")]
    pub cron_expr: Option<String>,
    pub created_at: String,
    pub trigger_at: String,
    pub status: TimerStatus,
}

/// Thread-safe timer store.
#[derive(Clone)]
pub struct TimerStore {
    timers: Arc<RwLock<HashMap<String, Timer>>>,
}

impl TimerStore {
    /// Create new timer store.
    pub fn new() -> Self {
        Self {
            timers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create a one-shot timer. Returns the created Timer.
    ///
    /// Owner is `(runtime_id, session_id)` — typically the caller session.
    pub async fn create_one_shot_timer(
        &self,
        runtime_id: &str,
        session_id: &str,
        executor_runtime_id: &str,
        executor_session_id: &str,
        title: &str,
        msg: &str,
        after_seconds: u64,
    ) -> Result<Timer> {
        if after_seconds == 0 {
            bail!("afterSeconds must be a positive integer");
        }
        if msg.trim().is_empty() {
            bail!("msg is required");
        }

        let now_ms = epoch_ms();
        let timer_id = format!("timer-{}", Uuid::new_v4());
        let created_at = ms_to_iso(now_ms);
        let trigger_at = ms_to_iso(now_ms + (after_seconds as u64) * 1000);

        let timer = Timer {
            timer_id: timer_id.clone(),
            runtime_id: runtime_id.to_string(),
            session_id: session_id.to_string(),
            executor_runtime_id: executor_runtime_id.to_string(),
            executor_session_id: executor_session_id.to_string(),
            title: if title.trim().is_empty() {
                "timer task".to_string()
            } else {
                title.to_string()
            },
            msg: msg.to_string(),
            timer_type: TimerType::OneShot,
            delay_seconds: after_seconds,
            every_seconds: None,
            cron_expr: None,
            created_at,
            trigger_at,
            status: TimerStatus::Pending,
        };

        let mut timers = self.timers.write().await;
        timers.insert(timer_id, timer.clone());
        Ok(timer)
    }

    /// Delete a timer by ID with ownership check.
    pub async fn delete_timer(
        &self,
        timer_id: &str,
        runtime_id: &str,
        session_id: &str,
    ) -> Result<bool> {
        let mut timers = self.timers.write().await;
        if let Some(timer) = timers.get(timer_id) {
            if timer.runtime_id != runtime_id || timer.session_id != session_id {
                bail!("TimerID not found for runtime/session");
            }
            timers.remove(timer_id);
            Ok(true)
        } else {
            bail!("TimerID not found for runtime/session");
        }
    }

    /// List timers filtered by runtime_id and session_id.
    pub async fn list_timers(&self, runtime_id: &str, session_id: &str) -> Vec<Timer> {
        let timers = self.timers.read().await;
        let mut list: Vec<Timer> = timers
            .values()
            .filter(|t| t.runtime_id == runtime_id && t.session_id == session_id)
            .cloned()
            .collect();
        list.sort_by(|a, b| a.trigger_at.cmp(&b.trigger_at));
        list
    }

    /// List all timers (manager scope).
    pub async fn list_all_timers(&self) -> Vec<Timer> {
        let timers = self.timers.read().await;
        let mut list: Vec<Timer> = timers.values().cloned().collect();
        list.sort_by(|a, b| a.trigger_at.cmp(&b.trigger_at));
        list
    }

    /// Drain all due timers (trigger_at <= now). One-shot timers are removed
    /// from the store after drain. Returns the list of due timers.
    pub async fn drain_due_timers(&self) -> Vec<Timer> {
        let now_ms = epoch_ms();
        let mut timers = self.timers.write().await;
        let mut due = Vec::new();
        let mut to_remove = Vec::new();

        for (id, timer) in timers.iter() {
            let trigger_ms = iso_to_ms(&timer.trigger_at);
            if trigger_ms <= now_ms && timer.status == TimerStatus::Pending {
                due.push(timer.clone());
                if timer.timer_type == TimerType::OneShot {
                    to_remove.push(id.clone());
                }
            }
        }

        for id in to_remove {
            timers.remove(&id);
        }

        due
    }

    /// Count of pending timers.
    pub async fn pending_count(&self) -> usize {
        let timers = self.timers.read().await;
        timers
            .values()
            .filter(|t| t.status == TimerStatus::Pending)
            .count()
    }
}

impl Default for TimerStore {
    fn default() -> Self {
        Self::new()
    }
}

// ── Time helpers ────────────────────────────────────────────────────

/// Get current epoch in milliseconds.
pub fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Convert epoch milliseconds to ISO 8601 string (UTC).
pub fn ms_to_iso(ms: u64) -> String {
    let total_secs = ms / 1000;
    let millis = ms % 1000;

    let mut remaining = total_secs;
    let sec = remaining % 60;
    remaining /= 60;
    let min = remaining % 60;
    remaining /= 60;
    let hour = remaining % 24;
    remaining /= 24;
    let total_days = remaining;

    let mut year = 1970u64;
    let mut days_left = total_days;
    loop {
        let days_in_year = if is_leap(year) { 366 } else { 365 };
        if days_left < days_in_year {
            break;
        }
        days_left -= days_in_year;
        year += 1;
    }

    let month_days_leap = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366];
    let month_days_norm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
    let md = if is_leap(year) {
        &month_days_leap
    } else {
        &month_days_norm
    };

    let mut month = 1u64;
    for m in 1..=12 {
        if days_left < md[m] {
            month = m as u64;
            days_left -= md[m - 1];
            break;
        }
    }
    let day = days_left + 1;

    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z"
    )
}

/// Parse ISO 8601 string to epoch milliseconds.
pub fn iso_to_ms(iso: &str) -> u64 {
    let cleaned = iso.trim_end_matches('Z').replace('T', " ");
    let parts: Vec<&str> = cleaned.split('.').collect();
    let main = parts[0];
    let frac_ms: u64 = if parts.len() > 1 {
        let frac_str: String = parts[1].chars().take(3).collect();
        frac_str.parse::<u64>().unwrap_or(0)
    } else {
        0
    };

    let tokens: Vec<&str> = main.split(&['-', ' ', ':'][..]).collect();
    if tokens.len() < 6 {
        return 0;
    }
    let year: u64 = tokens[0].parse().unwrap_or(1970);
    let month: u64 = tokens[1].parse().unwrap_or(1);
    let day: u64 = tokens[2].parse().unwrap_or(1);
    let hour: u64 = tokens[3].parse().unwrap_or(0);
    let min: u64 = tokens[4].parse().unwrap_or(0);
    let sec: u64 = tokens[5].parse().unwrap_or(0);

    let days = days_since_epoch(year, month, day);
    let total_secs = days * 86400 + hour * 3600 + min * 60 + sec;
    total_secs * 1000 + frac_ms
}

fn days_since_epoch(year: u64, month: u64, day: u64) -> u64 {
    let mut y = 1970u64;
    let mut days = 0u64;
    while y < year {
        days += if is_leap(y) { 366 } else { 365 };
        y += 1;
    }
    let month_days = [0u64, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for m in 1..month {
        days += month_days[m as usize];
        if m == 2 && is_leap(year) {
            days += 1;
        }
    }
    days + day - 1
}

fn is_leap(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_and_list_one_shot() {
        let store = TimerStore::new();
        let timer = store
            .create_one_shot_timer("rt1", "ses1", "exec-rt", "exec-ses", "test", "hello", 60)
            .await
            .unwrap();

        assert!(!timer.timer_id.is_empty());
        assert_eq!(timer.runtime_id, "rt1");
        assert_eq!(timer.session_id, "ses1");
        assert_eq!(timer.timer_type, TimerType::OneShot);
        assert_eq!(timer.status, TimerStatus::Pending);
        assert_eq!(timer.msg, "hello");
        assert_eq!(timer.delay_seconds, 60);

        let list = store.list_timers("rt1", "ses1").await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].timer_id, timer.timer_id);
    }

    #[tokio::test]
    async fn test_delete_timer() {
        let store = TimerStore::new();
        let timer = store
            .create_one_shot_timer("rt1", "ses1", "exec-rt", "exec-ses", "test", "hello", 60)
            .await
            .unwrap();

        let deleted = store
            .delete_timer(&timer.timer_id, "rt1", "ses1")
            .await
            .unwrap();
        assert!(deleted);

        let list = store.list_timers("rt1", "ses1").await;
        assert_eq!(list.len(), 0);
    }

    #[tokio::test]
    async fn test_delete_wrong_session_fails() {
        let store = TimerStore::new();
        let timer = store
            .create_one_shot_timer("rt1", "ses1", "exec-rt", "exec-ses", "test", "hello", 60)
            .await
            .unwrap();

        let result = store
            .delete_timer(&timer.timer_id, "rt1", "wrong-ses")
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_drain_due_timers_removes_one_shot() {
        let store = TimerStore::new();

        let timer = store
            .create_one_shot_timer("rt1", "ses1", "exec-rt", "exec-ses", "test", "hello", 60)
            .await
            .unwrap();

        // Set trigger_at to the past
        {
            let mut timers = store.timers.write().await;
            if let Some(t) = timers.get_mut(&timer.timer_id) {
                t.trigger_at = "2020-01-01T00:00:00.000Z".to_string();
            }
        }

        let due = store.drain_due_timers().await;
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].timer_id, timer.timer_id);

        // One-shot removed from store
        let list = store.list_all_timers().await;
        assert_eq!(list.len(), 0);
    }

    #[tokio::test]
    async fn test_drain_non_due_timer_stays() {
        let store = TimerStore::new();

        let _timer = store
            .create_one_shot_timer("rt1", "ses1", "exec-rt", "exec-ses", "test", "hello", 3600)
            .await
            .unwrap();

        let due = store.drain_due_timers().await;
        assert_eq!(due.len(), 0);

        let list = store.list_all_timers().await;
        assert_eq!(list.len(), 1);
    }

    #[tokio::test]
    async fn test_list_all_timers() {
        let store = TimerStore::new();
        store
            .create_one_shot_timer("rt1", "ses1", "exec-rt", "exec-ses", "t1", "msg1", 60)
            .await
            .unwrap();
        store
            .create_one_shot_timer("rt2", "ses2", "exec-rt", "exec-ses", "t2", "msg2", 120)
            .await
            .unwrap();

        let all = store.list_all_timers().await;
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn test_create_rejects_empty_msg() {
        let store = TimerStore::new();
        let result = store
            .create_one_shot_timer("rt1", "ses1", "exec-rt", "exec-ses", "test", "", 60)
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_rejects_zero_seconds() {
        let store = TimerStore::new();
        let result = store
            .create_one_shot_timer("rt1", "ses1", "exec-rt", "exec-ses", "test", "hello", 0)
            .await;
        assert!(result.is_err());
    }

    #[test]
    fn test_iso_roundtrip() {
        let ms = iso_to_ms("2026-01-01T00:00:00.000Z");
        let iso = ms_to_iso(ms);
        let ms2 = iso_to_ms(&iso);
        assert_eq!(ms, ms2);
    }

    #[test]
    fn test_ms_to_iso_known_value() {
        // 2026-01-01T00:00:00.000Z
        let ms = iso_to_ms("2026-01-01T00:00:00.000Z");
        let iso = ms_to_iso(ms);
        assert!(iso.starts_with("2026-01-01T00:00:00"));
    }
}
