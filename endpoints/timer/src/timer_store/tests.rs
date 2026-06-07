use super::*;

fn one_shot<'a>(title: &'a str, msg: &'a str, after_seconds: u64) -> CreateOneShotTimer<'a> {
    CreateOneShotTimer {
        runtime_id: "rt1",
        session_id: "ses1",
        executor_runtime_id: "exec-rt",
        executor_session_id: "exec-ses",
        title,
        msg,
        after_seconds,
    }
}

#[tokio::test]
async fn test_create_and_list_one_shot() {
    let store = TimerStore::new();
    let timer = store
        .create_one_shot_timer(one_shot("test", "hello", 60))
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
        .create_one_shot_timer(one_shot("test", "hello", 60))
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
        .create_one_shot_timer(one_shot("test", "hello", 60))
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
        .create_one_shot_timer(one_shot("test", "hello", 60))
        .await
        .unwrap();

    {
        let mut timers = store.timers.write().await;
        if let Some(t) = timers.get_mut(&timer.timer_id) {
            t.trigger_at = "2020-01-01T00:00:00.000Z".to_string();
        }
    }

    let due = store.drain_due_timers().await;
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].timer_id, timer.timer_id);

    let list = store.list_all_timers().await;
    assert_eq!(list.len(), 0);
}

#[tokio::test]
async fn test_drain_non_due_timer_stays() {
    let store = TimerStore::new();

    let _timer = store
        .create_one_shot_timer(one_shot("test", "hello", 3600))
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
        .create_one_shot_timer(one_shot("t1", "msg1", 60))
        .await
        .unwrap();
    store
        .create_one_shot_timer(CreateOneShotTimer {
            runtime_id: "rt2",
            session_id: "ses2",
            executor_runtime_id: "exec-rt",
            executor_session_id: "exec-ses",
            title: "t2",
            msg: "msg2",
            after_seconds: 120,
        })
        .await
        .unwrap();

    let all = store.list_all_timers().await;
    assert_eq!(all.len(), 2);
}

#[tokio::test]
async fn test_create_rejects_empty_msg() {
    let store = TimerStore::new();
    let result = store.create_one_shot_timer(one_shot("test", "", 60)).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_create_rejects_zero_seconds() {
    let store = TimerStore::new();
    let result = store
        .create_one_shot_timer(one_shot("test", "hello", 0))
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
    let ms = iso_to_ms("2026-01-01T00:00:00.000Z");
    let iso = ms_to_iso(ms);
    assert!(iso.starts_with("2026-01-01T00:00:00"));
}
