use ec_compat::binary_watch::{diff_package_reports, inspect_package};
use ec_compat::watch::{load_json, write_json};
use ec_compat::{Error, Result};
use std::path::{Path, PathBuf};

fn run() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
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
    if args.first().map(String::as_str) == Some("diff") {
        let old = args
            .get(1)
            .ok_or_else(|| Error("usage: ec-binary-watch diff OLD NEW [--output PATH]".into()))?;
        let new = args
            .get(2)
            .ok_or_else(|| Error("usage: ec-binary-watch diff OLD NEW [--output PATH]".into()))?;
        return write_json(
            output.as_deref(),
            &diff_package_reports(&load_json(Path::new(old))?, &load_json(Path::new(new))?)?,
        );
    }
    let package = args
        .first()
        .filter(|value| !value.starts_with("--"))
        .ok_or_else(|| Error("usage: ec-binary-watch PACKAGE [--output PATH]".into()))?;
    write_json(output.as_deref(), &inspect_package(Path::new(package))?)
}

fn main() {
    if let Err(error) = run() {
        eprintln!("ec-binary-watch: {error}");
        std::process::exit(1);
    }
}
