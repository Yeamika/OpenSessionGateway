use anyhow::Result;
use std::path::PathBuf;

#[path = "../feishu.rs"]
mod feishu;
#[path = "../im_config.rs"]
mod im_config;

#[tokio::main]
async fn main() -> Result<()> {
    let mut config_path: Option<PathBuf> = None;
    let mut account: Option<String> = None;
    let mut send = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--config" => config_path = args.next().map(PathBuf::from),
            "--account" => account = args.next(),
            "--send" => send = true,
            _ => {}
        }
    }
    let cfg = im_config::load_config(config_path.as_deref())?;
    let result = feishu::smoke_from_config(&cfg, account.as_deref(), send).await?;
    println!("feishu_smoke={result}");
    Ok(())
}
