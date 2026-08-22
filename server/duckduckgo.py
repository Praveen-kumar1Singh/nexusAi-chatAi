"""Minimal DuckDuckGo search client.

DuckDuckGo has no free official search API, so this reads their HTML endpoints:
"lite" first (a small, easily parsed table) and the classic "html" page as a
fallback. httpx already ships with the Groq SDK, so there is no third-party
search dependency to keep up with.

DuckDuckGo rate-limits by IP and answers with an HTTP 202 challenge page when it
decides you are a bot. That is detected explicitly and retried with backoff; if
it persists the caller gets SearchUnavailable rather than a silent empty list,
so the assistant can tell the user what happened instead of inventing an answer.
"""

import html
import re
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

import httpx

# The lite endpoint serves plain markup to a normal browser UA; without one it
# returns a challenge page immediately.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Official, documented, key-free JSON endpoint. Narrower than the HTML results
# (encyclopedic abstracts rather than a ranked web list) but it keeps answering
# when the scraped endpoints are rate-limited.
INSTANT_ANSWER = "https://api.duckduckgo.com/"

TIMEOUT_SECONDS = 15.0
ATTEMPT_DELAYS = (0.0, 1.5, 4.0)  # backoff before each attempt


class SearchUnavailable(RuntimeError):
    """DuckDuckGo refused to serve results (rate limit or markup change)."""


# lite.duckduckgo.com: <a href="URL" class='result-link'>TITLE</a>
_LITE_LINK = re.compile(
    r"<a[^>]*?href=\"(?P<href>[^\"]+)\"[^>]*?class=['\"]result-link['\"][^>]*>(?P<title>.*?)</a>",
    re.S,
)
_LITE_SNIPPET = re.compile(r"<td[^>]*?class=['\"]result-snippet['\"][^>]*>(?P<text>.*?)</td>", re.S)

# html.duckduckgo.com: <a class="result__a" href="URL">TITLE</a>
_HTML_LINK = re.compile(
    r"<a[^>]*?class=\"[^\"]*result__a[^\"]*\"[^>]*?href=\"(?P<href>[^\"]+)\"[^>]*>(?P<title>.*?)</a>",
    re.S,
)
_HTML_SNIPPET = re.compile(
    r"<a[^>]*?class=\"[^\"]*result__snippet[^\"]*\"[^>]*>(?P<text>.*?)</a>", re.S
)

_TAG = re.compile(r"<[^>]+>")

ENDPOINTS: Tuple[Tuple[str, re.Pattern, re.Pattern], ...] = (
    ("https://lite.duckduckgo.com/lite/", _LITE_LINK, _LITE_SNIPPET),
    ("https://html.duckduckgo.com/html/", _HTML_LINK, _HTML_SNIPPET),
)


def _clean(fragment: str) -> str:
    """Strip the <b> highlighting DuckDuckGo adds, unescape, collapse whitespace."""
    return " ".join(html.unescape(_TAG.sub("", fragment)).split())


def _is_blocked(response: httpx.Response) -> bool:
    """The anti-bot page comes back as 202 and mentions an 'anomaly'."""
    return response.status_code == 202 or "anomaly" in response.text[:4000].lower()


def _is_ad(url: str) -> bool:
    """Sponsored rows share the result class but point at DuckDuckGo's ad tracker."""
    host = urlparse(url).netloc.lower()
    return host.endswith("duckduckgo.com") or "/y.js" in url or "ad_provider=" in url


def _direct_url(href: str) -> str:
    """Unwrap DuckDuckGo's /l/?uddg= redirect when it uses one."""
    if href.startswith("//"):
        href = "https:" + href
    if "uddg=" in href:
        target = parse_qs(urlparse(href).query).get("uddg")
        if target:
            return unquote(target[0])
    return href


def _parse(page: str, link_re: re.Pattern, snippet_re: re.Pattern, limit: int):
    # Snippets follow their link in document order, so pair each link with the
    # first snippet appearing after it.
    snippets = [(m.start(), _clean(m.group("text"))) for m in snippet_re.finditer(page)]

    results: List[Dict[str, str]] = []
    for match in link_re.finditer(page):
        title = _clean(match.group("title"))
        url = _direct_url(html.unescape(match.group("href")))
        if not title or not url.startswith("http") or _is_ad(url):
            continue

        results.append(
            {
                "title": title,
                "url": url,
                "snippet": next((t for pos, t in snippets if pos > match.end()), ""),
            }
        )
        if len(results) >= limit:
            break
    return results


def _instant_answer(query: str, limit: int) -> List[Dict[str, str]]:
    """Fallback: DuckDuckGo's Instant Answer API."""
    response = httpx.get(
        INSTANT_ANSWER,
        params={"q": query, "format": "json", "no_html": 1, "skip_disambig": 1},
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT_SECONDS,
        follow_redirects=True,
    )
    if response.status_code != 200:
        return []

    try:
        payload = response.json()
    except ValueError:
        return []

    results: List[Dict[str, str]] = []

    abstract = _clean(payload.get("AbstractText") or "")
    if abstract and payload.get("AbstractURL"):
        results.append(
            {
                "title": _clean(payload.get("Heading") or query),
                "url": payload["AbstractURL"],
                "snippet": abstract,
            }
        )

    answer = _clean(payload.get("Answer") or "")
    if answer:
        results.append(
            {
                "title": _clean(payload.get("AnswerType") or "Instant answer"),
                "url": payload.get("AbstractURL") or "https://duckduckgo.com/?q=" + query,
                "snippet": answer,
            }
        )

    # RelatedTopics mixes flat entries with grouped ones under "Topics".
    def walk(topics):
        for topic in topics:
            if "Topics" in topic:
                walk(topic["Topics"])
            elif topic.get("FirstURL") and topic.get("Text"):
                text = _clean(topic["Text"])
                results.append(
                    {
                        "title": text.split(" - ")[0][:100],
                        "url": topic["FirstURL"],
                        "snippet": text,
                    }
                )

    walk(payload.get("RelatedTopics") or [])
    return results[:limit]


def search(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """Return [{title, url, snippet}] for a query.

    Raises SearchUnavailable if DuckDuckGo blocks every attempt.
    """
    last_error: Optional[str] = None

    for delay in ATTEMPT_DELAYS:
        if delay:
            time.sleep(delay)

        for endpoint, link_re, snippet_re in ENDPOINTS:
            try:
                response = httpx.post(
                    endpoint,
                    data={"q": query},
                    headers={"User-Agent": USER_AGENT},
                    timeout=TIMEOUT_SECONDS,
                    follow_redirects=True,
                )
            except httpx.HTTPError as exc:
                last_error = "network error: {}".format(exc)
                continue

            if _is_blocked(response):
                last_error = "DuckDuckGo returned its anti-bot page"
                continue

            results = _parse(response.text, link_re, snippet_re, max_results)
            if results:
                return results

            # Served a real page with nothing on it -- a genuine no-match.
            if response.status_code == 200:
                return []

    # Scraped endpoints are blocked; try the official JSON API before giving up.
    try:
        fallback = _instant_answer(query, max_results)
        if fallback:
            return fallback
    except httpx.HTTPError as exc:
        last_error = "instant answer failed: {}".format(exc)

    raise SearchUnavailable(
        "Web search is temporarily rate-limited by DuckDuckGo. Try again in a minute."
    )
