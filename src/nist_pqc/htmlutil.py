"""Small helpers for the ``<li>`` fragments NIST returns from its JSON APIs."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser


def clean(text: str) -> str:
    text = text.replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class LiNode:
    text: str = ""
    children: list["LiNode"] = field(default_factory=list)

    @property
    def label(self) -> str:
        return clean(self.text)

    def attrs(self) -> dict[str, str]:
        """Nested ``key: value`` lines, e.g. family: ARM64, series: Graviton4."""
        out: dict[str, str] = {}
        for child in self.children:
            key, value = split_kv(child.text)
            if key and value:
                out[key.lower()] = value
        return out


class _LiParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = LiNode()
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "li":
            node = LiNode()
            self.stack[-1].children.append(node)
            self.stack.append(node)

    def handle_endtag(self, tag: str) -> None:
        if tag == "li" and len(self.stack) > 1:
            self.stack.pop()

    def handle_data(self, data: str) -> None:
        self.stack[-1].text += data


def parse_list(html: str) -> list[LiNode]:
    if not html:
        return []
    parser = _LiParser()
    parser.feed(html)
    parser.close()
    return parser.root.children


def split_kv(text: str) -> tuple[str, str]:
    """Split ``"family: ARM64"`` into ``("family", "ARM64")``.

    Returns ``("", cleaned)`` when there is no single-word key.
    """
    text = clean(text)
    match = re.match(r"^([A-Za-z][A-Za-z0-9 _/()-]{0,40}):\s*(.*)$", text)
    if not match:
        return "", text
    key = match.group(1).strip()
    if len(key.split()) > 3:
        return "", text
    return key, match.group(2).strip()


def kv_dict(html: str) -> dict[str, str]:
    """Flatten the first-level ``key: value`` items of a capability fragment."""
    out: dict[str, str] = {}
    for node in parse_list(html):
        key, value = split_kv(node.text)
        if key:
            out[key.lower()] = value
    return out
