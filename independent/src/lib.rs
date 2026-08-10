pub mod adapter;
pub mod auth;
pub mod binary_watch;
pub mod config;
pub mod engine;
pub mod modern;
pub mod probe;
pub mod protocol_map;
pub mod resource_catalogue;
pub mod special_tls11;
pub mod tunnel;
pub mod watch;
pub mod xml;

use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub struct Error(pub String);

impl Display for Error {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self(error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
