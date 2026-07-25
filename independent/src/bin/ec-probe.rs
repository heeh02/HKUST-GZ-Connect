use ec_compat::probe::{read_credentials, run_probe_with_tunnel};
use ec_compat::watch::{load_json, write_json};
use ec_compat::{Error, Result};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

fn run() -> Result<i32> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if !args
        .iter()
        .any(|argument| argument == "--credentials-stdin")
    {
        return Err(Error(
            "--credentials-stdin is required; credential CLI flags do not exist".into(),
        ));
    }
    let config_path = args
        .iter()
        .position(|argument| argument == "--config")
        .and_then(|index| args.get(index + 1))
        .ok_or_else(|| Error("missing required argument: --config".into()))?;
    let output = args
        .iter()
        .position(|argument| argument == "--output")
        .map(|index| {
            args.get(index + 1)
                .cloned()
                .map(PathBuf::from)
                .ok_or_else(|| Error("--output requires a value".into()))
        })
        .transpose()?;
    let tunnel_executable = args
        .iter()
        .position(|argument| argument == "--tunnel-handshake")
        .map(|index| {
            args.get(index + 1)
                .cloned()
                .map(PathBuf::from)
                .ok_or_else(|| Error("--tunnel-handshake requires an executable path".into()))
        })
        .transpose()?;
    let modern_tunnel_probe = args
        .iter()
        .any(|argument| argument == "--modern-tunnel-probe");
    let (username, password) = read_credentials(std::io::stdin().lock())?;
    let username = Zeroizing::new(username);
    let password = Zeroizing::new(password);
    let (evidence, authenticated) = run_probe_with_tunnel(
        &load_json(Path::new(config_path))?,
        &username,
        &password,
        tunnel_executable.as_deref(),
        modern_tunnel_probe,
    )?;
    write_json(output.as_deref(), &evidence)?;
    Ok(if authenticated { 0 } else { 2 })
}

fn main() {
    match run() {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("ec-probe: {error}");
            std::process::exit(1);
        }
    }
}
