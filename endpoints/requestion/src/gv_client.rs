//! GV control-envelope construction for requestion responses.

use osgp::{SessionAddress, SessionEnvelope};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondRequest {
    #[serde(alias = "sessionID")]
    pub session_id: String,
    #[serde(alias = "requestID", alias = "requestionId")]
    pub request_id: String,
    #[serde(default, alias = "ExecutorSessionID", alias = "executorSessionID")]
    pub executor_session_id: Option<String>,
    #[serde(default, alias = "ExecutorRuntimeID", alias = "executorRuntimeID")]
    pub executor_runtime_id: Option<String>,
    #[serde(default)]
    pub decision: String,
    #[serde(default)]
    pub response: String,
    #[serde(default)]
    pub answers: Vec<Vec<String>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(runtime: &str, session: &str) -> SessionAddress {
        SessionAddress::new("domain-a", Some(runtime.into()), Some(session.into()))
    }

    #[test]
    fn builds_canonical_requestion_respond_control() {
        let source = addr("requestion-endpoint", "requestion-endpoint");
        let target = addr("runtime-a", "ses-a");
        let request = RespondRequest {
            session_id: "ses-a".into(),
            request_id: "req-a".into(),
            executor_session_id: Some("caller-ses".into()),
            executor_runtime_id: Some("caller-rt".into()),
            decision: "approve".into(),
            response: "ok".into(),
            answers: Vec::new(),
        };

        let envelope = build_requestion_respond(&source, target.clone(), &request);

        assert_eq!(envelope.source, source);
        assert_eq!(envelope.target, target);
        assert_eq!(envelope.link_type, "control");
        assert_eq!(envelope.subtype, "requestion_respond");
        assert_eq!(envelope.payload["sessionID"], "ses-a");
        assert_eq!(envelope.payload["requestID"], "req-a");
        assert_eq!(envelope.payload["answers"][0][0], "approve");
        assert_eq!(envelope.payload["response"], "ok");
        assert_eq!(envelope.payload["ExecutorSessionID"], "caller-ses");
        assert_eq!(envelope.payload["ExecutorRuntimeID"], "caller-rt");
    }

    #[test]
    fn maps_reject_and_free_response_answers() {
        assert_eq!(
            answers_from_decision("reject", ""),
            vec![vec!["deny".to_string()]]
        );
        assert_eq!(
            answers_from_decision("response", "hello"),
            vec![vec!["hello".to_string()]]
        );
    }

    #[test]
    fn accepts_legacy_field_spellings_for_api_body() {
        let parsed: RespondRequest = serde_json::from_value(json!({
            "sessionID": "ses-a",
            "requestID": "req-a",
            "ExecutorSessionID": "caller-ses",
            "decision": "approve"
        }))
        .unwrap();
        assert_eq!(parsed.session_id, "ses-a");
        assert_eq!(parsed.request_id, "req-a");
        assert_eq!(parsed.executor_session_id.as_deref(), Some("caller-ses"));
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct QueuedResponse {
    pub ok: bool,
    pub subtype: &'static str,
    pub session_id: String,
    pub request_id: String,
}

#[derive(Debug, Clone)]
pub struct OutboundControl {
    pub envelope: SessionEnvelope,
}

pub fn build_requestion_respond(
    source: &SessionAddress,
    target: SessionAddress,
    request: &RespondRequest,
) -> SessionEnvelope {
    let answers = if request.answers.is_empty() {
        answers_from_decision(&request.decision, &request.response)
    } else {
        request.answers.clone()
    };
    let response = if request.response.trim().is_empty() {
        request.decision.clone()
    } else {
        request.response.clone()
    };

    SessionEnvelope {
        id: Uuid::new_v4(),
        source: source.clone(),
        target,
        kind: "control".into(),
        link_type: "control".into(),
        subtype: "requestion_respond".into(),
        payload: json!({
            "sessionID": request.session_id,
            "sessionId": request.session_id,
            "requestID": request.request_id,
            "requestId": request.request_id,
            "requestionId": request.request_id,
            "decision": request.decision,
            "response": response,
            "answers": answers,
            "ExecutorSessionID": request.executor_session_id,
            "executorSessionID": request.executor_session_id,
            "ExecutorRuntimeID": request.executor_runtime_id,
            "executorRuntimeID": request.executor_runtime_id,
            "source": format_address(source),
        }),
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: None,
    }
}

fn answers_from_decision(decision: &str, response: &str) -> Vec<Vec<String>> {
    let clean_decision = decision.trim();
    if clean_decision.eq_ignore_ascii_case("approve") {
        return vec![vec!["approve".into()]];
    }
    if clean_decision.eq_ignore_ascii_case("reject") || clean_decision.eq_ignore_ascii_case("deny")
    {
        return vec![vec!["deny".into()]];
    }
    let clean_response = response.trim();
    if clean_response.is_empty() {
        vec![vec!["response".into()]]
    } else {
        vec![vec![clean_response.into()]]
    }
}

fn format_address(address: &SessionAddress) -> String {
    [
        Some(address.domain.as_str()),
        address.runtime.as_deref(),
        address.session.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("/")
}
