"""One polite, cached HTTP client for csrc.nist.gov."""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

import httpx

USER_AGENT = (
    "nist-pqc-coverage/0.1 (research; "
    "+https://github.com/dougcooper/nist-pqc-coverage)"
)


class Fetcher:
    """Rate-limited GET with a URL-keyed on-disk cache.

    A cached response is reused until it is older than ``max_age_days``
    (or forever when that is None), unless ``refresh`` is set.
    """

    def __init__(
        self,
        cache_dir: str | Path = ".cache",
        delay: float = 1.0,
        refresh: bool = False,
        max_age_days: float | None = 7,
        verbose: bool = True,
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.delay = delay
        self.refresh = refresh
        self.max_age = None if max_age_days is None else max_age_days * 86400
        self.verbose = verbose
        self.requests = 0
        self._last = 0.0
        self._client = httpx.Client(
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            follow_redirects=True,
            timeout=60.0,
        )

    def close(self) -> None:
        self._client.close()

    def _path(self, url: str, suffix: str) -> Path:
        digest = hashlib.sha256(url.encode()).hexdigest()[:24]
        return self.cache_dir / f"{digest}{suffix}"

    def _fresh(self, path: Path) -> bool:
        if not path.exists() or self.refresh:
            return False
        if self.max_age is None:
            return True
        return (time.time() - path.stat().st_mtime) < self.max_age

    def _wait(self) -> None:
        remaining = self.delay - (time.monotonic() - self._last)
        if remaining > 0:
            time.sleep(remaining)

    def get_text(self, url: str, suffix: str = ".html") -> str:
        path = self._path(url, suffix)
        if self._fresh(path):
            return path.read_text(encoding="utf-8", errors="replace")

        last_error: Exception | None = None
        for attempt in range(4):
            self._wait()
            try:
                response = self._client.get(url)
                self._last = time.monotonic()
                self.requests += 1
                response.raise_for_status()
                text = response.text
                path.write_text(text, encoding="utf-8")
                return text
            except httpx.HTTPError as exc:  # network or 4xx/5xx
                self._last = time.monotonic()
                self.requests += 1
                last_error = exc
                if self.verbose:
                    print(f"  retry {attempt + 1}/4 {url}: {exc}", file=sys.stderr)
                time.sleep(2**attempt)
        raise RuntimeError(f"GET failed after retries: {url} ({last_error})")

    def get_json(self, url: str):
        return json.loads(self.get_text(url, ".json"))

    def get_bytes(self, url: str, suffix: str = ".bin") -> bytes:
        path = self._path(url, suffix)
        if self._fresh(path):
            return path.read_bytes()

        last_error: Exception | None = None
        for attempt in range(4):
            self._wait()
            try:
                response = self._client.get(url)
                self._last = time.monotonic()
                self.requests += 1
                response.raise_for_status()
                path.write_bytes(response.content)
                return response.content
            except httpx.HTTPError as exc:
                self._last = time.monotonic()
                self.requests += 1
                last_error = exc
                if self.verbose:
                    print(f"  retry {attempt + 1}/4 {url}: {exc}", file=sys.stderr)
                time.sleep(2**attempt)
        raise RuntimeError(f"GET failed after retries: {url} ({last_error})")

    def get_html_fragment(self, url: str) -> str:
        """NIST REST endpoints return a JSON string containing HTML."""
        value = self.get_json(url)
        if not isinstance(value, str):
            raise ValueError(f"expected a JSON string from {url}, got {type(value)}")
        return value
