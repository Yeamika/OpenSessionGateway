use std::{sync::Arc, thread};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use pingora_core::{server::Server, upstreams::peer::HttpPeer};
use pingora_load_balancing::{selection::RoundRobin, LoadBalancer};
use pingora_proxy::{http_proxy_service, ProxyHttp, Session};

#[derive(Clone, Debug)]
pub struct PingoraIngressConfig {
    pub name: String,
    pub listen_addr: String,
    pub upstreams: Vec<String>,
}

pub fn spawn_pingora_ingress(configs: Vec<PingoraIngressConfig>) -> Result<thread::JoinHandle<()>> {
    if configs.is_empty() {
        return Err(anyhow!("at least one Pingora ingress config is required"));
    }

    let handle = thread::Builder::new()
        .name("glassvein-pingora-ingress".to_string())
        .spawn(move || {
            let mut server = Server::new(None).expect("create Pingora server");
            server.bootstrap();

            for config in configs {
                let refs = config
                    .upstreams
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                let lb = LoadBalancer::<RoundRobin>::try_from_iter(refs)
                    .expect("create Pingora load balancer");
                let ingress = GlassVeinPingoraIngress {
                    name: config.name.clone(),
                    upstreams: Arc::new(lb),
                };
                let mut service = http_proxy_service(&server.configuration, ingress);
                service.add_tcp(&config.listen_addr);
                server.add_service(service);
            }

            server.run_forever();
        })?;

    Ok(handle)
}

struct GlassVeinPingoraIngress {
    name: String,
    upstreams: Arc<LoadBalancer<RoundRobin>>,
}

#[async_trait]
impl ProxyHttp for GlassVeinPingoraIngress {
    type CTX = ();

    fn new_ctx(&self) -> Self::CTX {}

    async fn upstream_peer(
        &self,
        session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> pingora_core::Result<Box<HttpPeer>> {
        let key = session.req_header().uri.path().as_bytes();
        let upstream = self
            .upstreams
            .select(key, 256)
            .expect("Pingora ingress has no selectable upstream");

        println!(
            "glassvein-pingora ingress={} selected_upstream={upstream:?} path={}",
            self.name,
            session.req_header().uri.path(),
        );

        Ok(Box::new(HttpPeer::new(upstream, false, String::new())))
    }
}
