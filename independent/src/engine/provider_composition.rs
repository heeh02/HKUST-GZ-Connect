//! Compile-time production provider selection.
//!
//! A school profile selects one closed protocol family. The family maps to a
//! reviewed provider set; JSON cannot name arbitrary implementations and no
//! dynamic plugin ABI exists. Adding another family requires a new compiled
//! branch and its own evidence/tests.

use crate::engine::provider::{
    CapabilityModel, ProviderCapabilityReport, ProviderCoordinator, UnsupportedResourceProvider,
};
use crate::engine::session::{ModernL3TransportBackend, ProductionPasswordAuthProvider};
use crate::{Error, ErrorKind, Result};
use serde_json::Value;

pub const EASYCONNECT_PASSWORD_MODERN_L3_V1: &str = "easyconnect-password-modern-l3-v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProductionProviderFamily {
    EasyConnectPasswordModernL3V1,
}

impl ProductionProviderFamily {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            EASYCONNECT_PASSWORD_MODERN_L3_V1 => Ok(Self::EasyConnectPasswordModernL3V1),
            _ => Err(Error::classified(
                ErrorKind::Configuration,
                "production provider family is unsupported",
            )),
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::EasyConnectPasswordModernL3V1 => EASYCONNECT_PASSWORD_MODERN_L3_V1,
        }
    }

    pub const fn compiled_capabilities(self) -> CapabilityModel {
        match self {
            Self::EasyConnectPasswordModernL3V1 => CapabilityModel::production_password_l3(),
        }
    }

    pub const fn selected_capabilities(self) -> CapabilityModel {
        match self {
            Self::EasyConnectPasswordModernL3V1 => CapabilityModel::production_password_l3(),
        }
    }

    pub fn capability_report(self) -> Result<ProviderCapabilityReport> {
        ProviderCapabilityReport::new(self.compiled_capabilities(), self.selected_capabilities())
    }
}

type CurrentProductionCoordinator = ProviderCoordinator<
    ProductionPasswordAuthProvider,
    UnsupportedResourceProvider,
    ModernL3TransportBackend,
>;

pub struct ProductionProviderSet {
    family: ProductionProviderFamily,
    coordinator: CurrentProductionCoordinator,
}

impl ProductionProviderSet {
    pub fn from_config(family: ProductionProviderFamily, config: &Value) -> Result<Self> {
        match family {
            ProductionProviderFamily::EasyConnectPasswordModernL3V1 => {
                let coordinator = ProviderCoordinator::new(
                    ProductionPasswordAuthProvider::new(config),
                    UnsupportedResourceProvider,
                    ModernL3TransportBackend::new(config)?,
                    family.compiled_capabilities(),
                )?;
                Ok(Self {
                    family,
                    coordinator,
                })
            }
        }
    }

    pub const fn family(&self) -> ProductionProviderFamily {
        self.family
    }

    pub const fn capabilities(&self) -> CapabilityModel {
        self.coordinator.model()
    }

    pub fn capability_report(&self) -> &ProviderCapabilityReport {
        self.coordinator.report()
    }

    pub fn authentication_provider(&self) -> ProductionPasswordAuthProvider {
        self.coordinator.authentication().clone()
    }

    pub fn transport_backend(&self) -> ModernL3TransportBackend {
        self.coordinator.transport().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::provider::{Capability, CapabilityAvailability};
    use serde_json::json;

    fn config() -> Value {
        json!({
            "base_url": "https://gateway.example.test",
            "endpoints": { "session_config": "/por/conf.csp" }
        })
    }

    #[test]
    fn current_family_builds_one_password_modern_l3_provider_set() {
        let family = ProductionProviderFamily::parse(EASYCONNECT_PASSWORD_MODERN_L3_V1).unwrap();
        let providers = ProductionProviderSet::from_config(family, &config()).unwrap();
        assert_eq!(providers.family().name(), EASYCONNECT_PASSWORD_MODERN_L3_V1);
        assert_eq!(
            providers
                .capabilities()
                .availability(Capability::AuthPassword),
            CapabilityAvailability::Supported
        );
        assert_eq!(
            providers
                .capabilities()
                .availability(Capability::TransportL3),
            CapabilityAvailability::Supported
        );
        assert_eq!(
            providers
                .capabilities()
                .availability(Capability::ResourceCatalogue),
            CapabilityAvailability::Unsupported
        );
    }

    #[test]
    fn unknown_family_and_invalid_transport_config_fail_before_network_work() {
        assert!(ProductionProviderFamily::parse("dynamic-provider-name").is_err());
        let family = ProductionProviderFamily::EasyConnectPasswordModernL3V1;
        assert!(ProductionProviderSet::from_config(family, &json!({})).is_err());
    }
}
