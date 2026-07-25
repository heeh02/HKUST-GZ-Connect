use ec_compat::binary_watch::inspect_package;
use ec_compat::watch::write_json;
use ec_compat::{Error, Result};
use std::path::{Path, PathBuf};

fn run() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let package = args
        .first()
        .filter(|value| !value.starts_with("--"))
        .ok_or_else(|| Error("usage: ec-binary-watch PACKAGE [--output PATH]".into()))?;
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
    write_json(output.as_deref(), &inspect_package(Path::new(package))?)
}

fn main() {
    if let Err(error) = run() {
        eprintln!("ec-binary-watch: {error}");
        std::process::exit(1);
    }
}
