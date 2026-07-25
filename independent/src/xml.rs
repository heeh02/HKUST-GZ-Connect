use crate::{Error, Result};

pub const MAX_XML_BYTES: usize = 5 * 1024 * 1024;

pub fn parse_xml<'a>(data: &'a [u8], source: &str) -> Result<roxmltree::Document<'a>> {
    if data.len() > MAX_XML_BYTES {
        return Err(Error(format!(
            "{source}: XML exceeds {MAX_XML_BYTES} bytes"
        )));
    }
    let upper = data.iter().map(u8::to_ascii_uppercase).collect::<Vec<_>>();
    if upper.windows(9).any(|value| value == b"<!DOCTYPE")
        || upper.windows(8).any(|value| value == b"<!ENTITY")
    {
        return Err(Error(format!(
            "{source}: DTD/entity declarations are not accepted"
        )));
    }
    let text = std::str::from_utf8(data)
        .map_err(|error| Error(format!("{source}: invalid UTF-8: {error}")))?;
    roxmltree::Document::parse(text)
        .map_err(|error| Error(format!("{source}: invalid XML: {error}")))
}

pub fn first_descendant_text(node: roxmltree::Node<'_, '_>, name: &str) -> String {
    node.descendants()
        .find(|candidate| candidate.is_element() && candidate.tag_name().name() == name)
        .and_then(|candidate| candidate.text())
        .unwrap_or_default()
        .trim()
        .to_owned()
}

pub fn direct_child<'a, 'input>(
    node: roxmltree::Node<'a, 'input>,
    name: &str,
) -> Option<roxmltree::Node<'a, 'input>> {
    node.children()
        .find(|candidate| candidate.is_element() && candidate.tag_name().name() == name)
}

pub fn child_text(node: roxmltree::Node<'_, '_>, name: &str) -> String {
    direct_child(node, name)
        .and_then(|candidate| candidate.text())
        .unwrap_or_default()
        .trim()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_entities() {
        let data = br#"<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><x>&y;</x>"#;
        assert!(parse_xml(data, "test").is_err());
    }
}
