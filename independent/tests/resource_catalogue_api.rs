use ec_compat::resource_catalogue::{RESOURCE_CATALOGUE_SCHEMA_VERSION, parse_resource_catalogue};
use serde_json::json;

#[test]
fn presentation_api_v1_is_an_exact_offline_contract() {
    let catalogue =
        parse_resource_catalogue(include_bytes!("fixtures/resource_catalogue.xml")).unwrap();
    let actual = serde_json::to_value(catalogue.sanitized_view()).unwrap();
    let expected = json!({
        "schema_version": RESOURCE_CATALOGUE_SCHEMA_VERSION,
        "groups": [
            {
                "handle": "group-6afe904af173d9d397cd98e6",
                "label": "教学资源",
                "resource_count": 2
            },
            {
                "handle": "group-959f07a8a9c4cb4015b420d8",
                "label": "行政资源",
                "resource_count": 1
            }
        ],
        "resources": [
            {
                "handle": "resource-502d928526a33359a4bfa0fe",
                "label": "合成教学门户",
                "group_handle": "group-6afe904af173d9d397cd98e6",
                "kind": "web",
                "protocol": "https",
                "authorization": "declared_unverified",
                "authorization_decision_available": false,
                "target": {
                    "location": "absolute_url",
                    "host_kind": "domain",
                    "explicit_port": false,
                    "path_present": true,
                    "query_present": true,
                    "fragment_present": true,
                    "ports": {
                        "unrestricted": false,
                        "ranges": [{"start": 443, "end": 443}]
                    }
                }
            },
            {
                "handle": "resource-b0237a79130452f424f7f75b",
                "label": "合成终端服务",
                "group_handle": "group-6afe904af173d9d397cd98e6",
                "kind": "tcp",
                "protocol": "tcp",
                "authorization": "not_declared",
                "authorization_decision_available": false,
                "target": {
                    "location": "host",
                    "host_kind": "domain",
                    "explicit_port": false,
                    "path_present": false,
                    "query_present": false,
                    "fragment_present": false,
                    "ports": {
                        "unrestricted": false,
                        "ranges": [
                            {"start": 22, "end": 22},
                            {"start": 80, "end": 90}
                        ]
                    }
                }
            },
            {
                "handle": "resource-a7b0770fdc44ecf7874d02cc",
                "label": "合成应用",
                "group_handle": "group-959f07a8a9c4cb4015b420d8",
                "kind": "application",
                "protocol": "udp",
                "authorization": "declared_unverified",
                "authorization_decision_available": false,
                "target": {
                    "location": "host",
                    "host_kind": "ipv4",
                    "explicit_port": false,
                    "path_present": false,
                    "query_present": false,
                    "fragment_present": false,
                    "ports": {
                        "unrestricted": false,
                        "ranges": [{"start": 5000, "end": 5010}]
                    }
                }
            }
        ],
        "default_resource_handle": "resource-502d928526a33359a4bfa0fe",
        "dns_policy_present": true,
        "authorization_decisions_available": false
    });
    assert_eq!(actual, expected);

    let output = actual.to_string();
    for private in [
        "catalogue.example.test",
        "/launch/private",
        "fixture-access-token",
        "fixture-session",
        "vendor-resource-one",
        "vendor-group-one",
        "synthetic-user",
        "synthetic-password",
        "fixture-private-service",
        "vendor-opaque-grant",
        "vendor-opaque-deny",
    ] {
        assert!(
            !output.contains(private),
            "presentation API leaked {private}"
        );
    }
}
