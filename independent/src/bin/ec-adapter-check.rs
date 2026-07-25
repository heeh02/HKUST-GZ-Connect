use ec_compat::adapter::OfficialPrefaceAdapter;
use ec_compat::watch::{diff_snapshots, load_json, write_json};
use ec_compat::{Error, Result};
use std::env;
use std::path::{Path, PathBuf};

fn usage() -> &'static str {
    "usage: ec-adapter-check <official-executable> [--output <json>] \
     [--compare <baseline>] [--diff-output <json>] [--fail-on-change]"
}

struct Arguments {
    executable: PathBuf,
    output: Option<PathBuf>,
    compare: Option<PathBuf>,
    diff_output: Option<PathBuf>,
    fail_on_change: bool,
}

fn parse_args() -> Result<Arguments> {
    let mut arguments = env::args_os().skip(1);
    let executable = arguments
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| Error(usage().into()))?;
    let mut output = None;
    let mut compare = None;
    let mut diff_output = None;
    let mut fail_on_change = false;
    while let Some(argument) = arguments.next() {
        match argument.to_str() {
            Some("--output") => {
                output = Some(
                    arguments
                        .next()
                        .map(PathBuf::from)
                        .ok_or_else(|| Error("--output requires a path".into()))?,
                );
            }
            Some("--compare") => {
                compare = Some(
                    arguments
                        .next()
                        .map(PathBuf::from)
                        .ok_or_else(|| Error("--compare requires a path".into()))?,
                );
            }
            Some("--diff-output") => {
                diff_output = Some(
                    arguments
                        .next()
                        .map(PathBuf::from)
                        .ok_or_else(|| Error("--diff-output requires a path".into()))?,
                );
            }
            Some("--fail-on-change") => fail_on_change = true,
            _ => return Err(Error(usage().into())),
        }
    }
    Ok(Arguments {
        executable,
        output,
        compare,
        diff_output,
        fail_on_change,
    })
}

fn run() -> Result<i32> {
    let arguments = parse_args()?;
    let adapter = OfficialPrefaceAdapter::from_executable(&arguments.executable)?;
    adapter.validate()?;
    let filename = arguments
        .executable
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let summary = adapter.sanitized_summary(&filename);
    write_json(arguments.output.as_deref(), &summary)?;
    if let Some(baseline_path) = arguments.compare {
        let diff = diff_snapshots(&load_json(Path::new(&baseline_path))?, &summary);
        write_json(arguments.diff_output.as_deref(), &diff)?;
        if arguments.fail_on_change && diff["changed"].as_bool() == Some(true) {
            return Ok(2);
        }
    }
    Ok(0)
}

fn main() {
    match run() {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("ec-adapter-check: {error}");
            std::process::exit(1);
        }
    }
}
