use ec_compat::gateway_probe::probe_public_gateway;
use std::time::Duration;

fn origin_argument(arguments: &[String]) -> Option<&str> {
    if arguments.len() != 2 || arguments[0] != "--origin" {
        return None;
    }
    Some(arguments[1].as_str())
}

fn main() {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let Some(origin) = origin_argument(&arguments) else {
        eprintln!("ec-gateway-probe: expected one Gateway origin");
        std::process::exit(64);
    };
    match probe_public_gateway(origin, 1, Duration::from_secs(8)) {
        Ok(result) => match serde_json::to_string(&result) {
            Ok(json) => println!("{json}"),
            Err(_) => {
                eprintln!("ec-gateway-probe: result could not be encoded");
                std::process::exit(1);
            }
        },
        Err(_) => {
            eprintln!("ec-gateway-probe: compatibility check failed");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argument_contract_is_exact_and_does_not_accept_extra_request_material() {
        let valid = vec!["--origin".into(), "https://gateway.example.test".into()];
        assert_eq!(
            origin_argument(&valid),
            Some("https://gateway.example.test")
        );
        for invalid in [
            vec![],
            vec!["--origin".into()],
            vec!["--path".into(), "/private".into()],
            vec![
                "--origin".into(),
                "https://gateway.example.test".into(),
                "secret".into(),
            ],
        ] {
            assert_eq!(origin_argument(&invalid), None);
        }
    }
}
