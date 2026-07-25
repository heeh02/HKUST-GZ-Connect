use ec_compat::watch::{collect_snapshot, diff_snapshots, load_json, write_json};
use ec_compat::{Error, Result};
use std::path::{Path, PathBuf};

fn value(args: &[String], name: &str) -> Result<Option<String>> {
    let Some(index) = args.iter().position(|argument| argument == name) else {
        return Ok(None);
    };
    args.get(index + 1)
        .filter(|next| !next.starts_with("--"))
        .cloned()
        .map(Some)
        .ok_or_else(|| Error(format!("{name} requires a value")))
}

fn required(args: &[String], name: &str) -> Result<String> {
    value(args, name)?.ok_or_else(|| Error(format!("missing required argument: {name}")))
}

fn output(value: Option<String>) -> Option<PathBuf> {
    value.map(PathBuf::from)
}

fn run() -> Result<i32> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let command = args
        .first()
        .ok_or_else(|| Error("usage: ec-watch <collect|diff> ...".into()))?;
    match command.as_str() {
        "collect" => {
            let config_path = required(&args, "--config")?;
            let snapshot = collect_snapshot(&load_json(Path::new(&config_path))?)?;
            let output_path = output(value(&args, "--output")?);
            write_json(output_path.as_deref(), &snapshot)?;
            if let Some(compare) = value(&args, "--compare")? {
                let result = diff_snapshots(&load_json(Path::new(&compare))?, &snapshot);
                let diff_output = output(value(&args, "--diff-output")?);
                write_json(diff_output.as_deref(), &result)?;
                if args.iter().any(|argument| argument == "--fail-on-change")
                    && result["changed"].as_bool() == Some(true)
                {
                    return Ok(2);
                }
            }
            Ok(0)
        }
        "diff" => {
            let positional = args[1..]
                .iter()
                .filter(|argument| !argument.starts_with("--"))
                .take(2)
                .cloned()
                .collect::<Vec<_>>();
            if positional.len() != 2 {
                return Err(Error("usage: ec-watch diff OLD NEW [--output PATH]".into()));
            }
            let result = diff_snapshots(
                &load_json(Path::new(&positional[0]))?,
                &load_json(Path::new(&positional[1]))?,
            );
            let output_path = output(value(&args, "--output")?);
            write_json(output_path.as_deref(), &result)?;
            if args.iter().any(|argument| argument == "--fail-on-change")
                && result["changed"].as_bool() == Some(true)
            {
                Ok(2)
            } else {
                Ok(0)
            }
        }
        _ => Err(Error(format!("unknown command: {command}"))),
    }
}

fn main() {
    match run() {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("ec-watch: {error}");
            std::process::exit(1);
        }
    }
}
