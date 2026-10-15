#!/usr/bin/env python3
"""
Generates SYNTHETIC CSV fixtures for M4 (competitor gap CSV import).

Nothing here is real vendor data. Domains are made up ("fixture-*"). Headers
imitate what Ahrefs, Semrush and Google Search Console exports look like, from
memory, so treat the header names as "close", not exact. The parts that matter
for the file reader are the encodings, delimiters, quoting, preambles and
broken rows, and those are deliberate.

Usage (from repo root):
    python3 scripts/make_csv_fixtures.py                 # writes fixtures/csv/
    python3 scripts/make_csv_fixtures.py --big 1000000   # also writes big_1m.csv (do not commit)
    python3 scripts/make_csv_fixtures.py --check         # re-parses everything against manifest.json

Output: fixtures/csv/*.csv and fixtures/csv/manifest.json (ground truth for tests).
"""
import argparse
import csv
import io
import json
import sys
from pathlib import Path

OUT = Path("fixtures/csv")

BOMS = {"utf-8": b"\xef\xbb\xbf", "utf-16-le": b"\xff\xfe"}

# (domain, title word). Reused across rows on purpose: distinct-domain counts matter.
DOMAINS = [
    "fixture-blog-01.com", "fixture-news-02.org", "fixture-shop-03.co.uk",
    "fixture-edu-04.net", "fixture-forum-05.com", "fixture-review-06.io",
    "fixture-guide-07.com", "fixture-tech-08.org", "fixture-home-09.com",
    "fixture-travel-10.net", "fixture-food-11.com", "fixture-health-12.org",
    "fixture-finance-13.com", "fixture-sport-14.co.uk",
]
TARGET = "rival-fixture.com"


def encode(text: str, encoding: str, bom: bool) -> bytes:
    data = text.encode(encoding)
    return (BOMS[encoding] + data) if bom else data


def to_csv(headers, rows, delimiter=",", quoting=csv.QUOTE_MINIMAL, eol="\r\n") -> str:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=delimiter, quoting=quoting, lineterminator=eol)
    w.writerow(headers)
    w.writerows(rows)
    return buf.getvalue()


def link_rows(n=30):
    """Backlink rows as dicts: page url/title/anchor/dates for n links."""
    rows = []
    for i in range(n):
        d = DOMAINS[(i * 5) % len(DOMAINS)]
        sub = "www." if i % 3 == 0 else ""
        path = f"/articles/post-{i:02d}"
        title = f"Post {i}: best \"budget\" tools, reviewed" if i % 7 == 0 else f"Post {i} about gadgets"
        rows.append(
            {
                "url": f"https://{sub}{d}{path}",
                "title": title,
                "anchor": "rival fixture" if i % 2 else "click here",
                "target": f"https://{TARGET}/" + ("pricing" if i % 4 == 0 else ""),
                "first": f"2026-0{1 + i % 9}-1{i % 9}",
                "last": f"2026-10-0{1 + i % 9}",
                "nofollow": "true" if i % 5 == 0 else "false",
                "domain": d,
            }
        )
    return rows


AHREFS_HEADERS = [
    "Referring page title", "Referring page URL", "Language", "Platform",
    "Referring page HTTP code", "Domain rating", "UR", "Referring domains",
    "Linked domains", "External links", "Page traffic", "Keywords",
    "Target URL", "Left context", "Anchor", "Right context", "Type",
    "Nofollow", "UGC", "Sponsored", "First seen", "Last seen", "Lost status",
]


def ahrefs_rows():
    out = []
    for i, r in enumerate(link_rows()):
        left = "As reviewed by\nour editors, " if i == 3 else "see "  # one multi-line cell
        out.append(
            [
                r["title"], r["url"], "en", "Desktop", "200", str(20 + i), str(10 + i),
                str(3 + i % 4), str(5 + i % 6), str(8 + i % 9), str(i * 13), str(i * 2),
                r["target"], left, r["anchor"], " for details", "text",
                r["nofollow"], "false", "false", r["first"], r["last"], "",
            ]
        )
    return out


SEMRUSH_HEADERS = [
    "Page ascore", "Source title", "Source url", "Target url", "Anchor",
    "External links", "Internal links", "Nofollow", "Sponsored", "Ugc", "Text",
    "Frame", "Form", "Image", "Sitewide", "First seen", "Last seen", "New link", "Lost link",
]


def semrush_rows():
    out = []
    for i, r in enumerate(link_rows()):
        out.append(
            [
                str(30 + i), r["title"], r["url"], r["target"], r["anchor"],
                str(4 + i % 5), str(10 + i % 7), r["nofollow"], "false", "false", "true",
                "false", "false", "false", "false", r["first"], r["last"],
                "true" if i % 6 == 0 else "false", "false",
            ]
        )
    return out


def write(name, data: bytes):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_bytes(data)


def build():
    manifest = {
        "_note": "ALL FILES SYNTHETIC. Header names imitate vendors from memory. "
        "line numbers are 1-based physical lines. Replace/extend with real exports under fixtures/csv/real/.",
        "files": {},
    }

    # 1. Ahrefs-like, UTF-8 with BOM, comma, one multi-line quoted cell
    rows = ahrefs_rows()
    write("ahrefs-like_utf8-bom.csv", encode(to_csv(AHREFS_HEADERS, rows), "utf-8", True))
    manifest["files"]["ahrefs-like_utf8-bom.csv"] = {
        "shape": "full backlink export", "encoding": "utf-8", "bom": True, "delimiter": ",",
        "header_line": 1, "url_column": "Referring page URL", "data_records": len(rows),
        "distinct_domains": len({r[1].split("/")[2].removeprefix("www.") for r in rows}),
        "notes": "record 4 has a quoted cell containing a newline, so physical lines != records",
    }

    # 2. Same data, UTF-16 LE with BOM, tab-delimited (what older Ahrefs exports looked like)
    write("ahrefs-like_utf16le-tab.csv",
          encode(to_csv(AHREFS_HEADERS, rows, delimiter="\t", eol="\n"), "utf-16-le", True))
    manifest["files"]["ahrefs-like_utf16le-tab.csv"] = {
        "shape": "full backlink export", "encoding": "utf-16-le", "bom": True, "delimiter": "\t",
        "header_line": 1, "url_column": "Referring page URL", "data_records": len(rows),
        "distinct_domains": manifest["files"]["ahrefs-like_utf8-bom.csv"]["distinct_domains"],
        "notes": "must be decoded as UTF-16 before splitting; tab delimiter",
    }

    # 3. Semrush-like, UTF-8 no BOM, every field quoted
    rows = semrush_rows()
    write("semrush-like_quoted.csv",
          encode(to_csv(SEMRUSH_HEADERS, rows, quoting=csv.QUOTE_ALL, eol="\n"), "utf-8", False))
    manifest["files"]["semrush-like_quoted.csv"] = {
        "shape": "full backlink export", "encoding": "utf-8", "bom": False, "delimiter": ",",
        "header_line": 1, "url_column": "Source url", "data_records": len(rows),
        "distinct_domains": len({r[2].split("/")[2].removeprefix("www.") for r in rows}),
        "notes": "every field quoted",
    }

    # 4. GSC-like "top linking sites": DOMAINS ONLY, no URLs
    gsc_sites = [[d, str(3 + i * 2), str(1 + i % 3)] for i, d in enumerate(DOMAINS)]
    write("gsc-like_top-linking-sites.csv",
          encode(to_csv(["Site", "Linking pages", "Target pages"], gsc_sites, eol="\n"), "utf-8", False))
    manifest["files"]["gsc-like_top-linking-sites.csv"] = {
        "shape": "domain-only", "encoding": "utf-8", "bom": False, "delimiter": ",",
        "header_line": 1, "url_column": "Site", "data_records": len(gsc_sites),
        "distinct_domains": len(DOMAINS),
        "notes": "NO URLs, bare domains. Decision needed: accept as https://<domain>/ (recommended)",
    }

    # 5. GSC-like "latest links": page URLs
    gsc_links = [[r["url"], r["target"], r["last"]] for r in link_rows(25)]
    write("gsc-like_latest-links.csv",
          encode(to_csv(["Linking page", "Target page", "Last crawled"], gsc_links, eol="\n"), "utf-8", False))
    manifest["files"]["gsc-like_latest-links.csv"] = {
        "shape": "page urls", "encoding": "utf-8", "bom": False, "delimiter": ",",
        "header_line": 1, "url_column": "Linking page", "data_records": len(gsc_links),
        "distinct_domains": len({r[0].split("/")[2].removeprefix("www.") for r in gsc_links}),
        "notes": "",
    }

    # 6. Edge: messy rows. Each tuple = (raw line, category, detail)
    messy = [
        ("https://fixture-blog-01.com/post-1,Plain valid,", "valid", {}),
        ("HTTPS://FIXTURE-BLOG-01.COM/post-1,Upper-case scheme and host,", "valid", {"dup_of": 2}),
        ("https://fixture-blog-01.com/post-1#comments,Fragment,", "valid", {"dup_of": 2}),
        ("https://fixture-blog-01.com/post-1?utm_source=x&utm_medium=y,Tracking params,", "valid", {"dup_of": "pending-normalizer"}),
        ("http://fixture-blog-01.com/post-1,http not https,", "valid", {"dup_of": "pending-normalizer"}),
        ("https://fixture-blog-01.com/post-1/,Trailing slash,", "valid", {"dup_of": "pending-normalizer"}),
        ("  https://fixture-news-02.org/a  ,Whitespace around url,", "valid", {}),
        ('"https://fixture-news-02.org/a,b",Quoted url with comma,', "valid", {}),
        ("https://fixture-shop-03.co.uk/café,Non-ASCII path,", "valid", {}),
        ("https://bücher-fixture.de/seite,IDN host,", "valid", {}),
        ("https://fixture-edu-04.net:8443/x,Port,", "valid", {}),
        ("fixture-blog-05.com/no-scheme,No scheme,", "ambiguous", {"suggest": "accept, prefix https://"}),
        ("//fixture-blog-06.com/proto-relative,Protocol-relative,", "ambiguous", {"suggest": "accept, prefix https:"}),
        ("www.fixture-blog-07.com,Bare www host,", "ambiguous", {"suggest": "accept, prefix https://"}),
        ("javascript:alert(1),Script scheme,", "invalid", {"error": "not_http"}),
        ("mailto:someone@fixture-blog-08.com,Mail link,", "invalid", {"error": "not_http"}),
        ("ftp://fixture-blog-09.com/file,FTP,", "invalid", {"error": "not_http"}),
        ("N/A,Placeholder text,", "invalid", {"error": "bad_url"}),
        ("https://,Scheme only,", "invalid", {"error": "bad_url"}),
        ("https://fixture blog.com/x,Space in host,", "invalid", {"error": "bad_url"}),
        ("http://192.168.0.1/admin,IP address host,", "invalid", {"error": "no_domain"}),
        ("http://localhost:3000/x,localhost,", "invalid", {"error": "no_domain"}),
        ("https://fixture-blog-11.com/" + "a" * 2200 + ",Normalized url over 2100,", "invalid", {"error": "too_long"}),
        ("https://fixture-blog-12.com/" + "b" * 4200 + ",Raw url over 4096,", "invalid", {"error": "too_long"}),
        (",Empty url but other columns filled,", "invalid", {"error": "empty_url"}),
        ("", "blank", {}),
        ("https://fixture-blog-13.com/ragged", "valid", {"note": "ragged: fewer fields than header"}),
        ("https://fixture-blog-14.com/extra,t,n,surplus,more", "valid", {"note": "more fields than header"}),
        ("https://fixture-blog-01.com/post-1,Exact repeat of line 2,", "valid", {"dup_of": 2}),
    ]
    lines = ["url,title,notes"] + [m[0] for m in messy]
    write("edge_messy.csv", encode("\n".join(lines) + "\n", "utf-8", False))
    manifest["files"]["edge_messy.csv"] = {
        "shape": "edge cases", "encoding": "utf-8", "bom": False, "delimiter": ",",
        "header_line": 1, "url_column": "url", "data_lines": len(messy),
        "rows": [
            {"line": i + 2, "category": c, **d} for i, (_, c, d) in enumerate(messy)
        ],
        "notes": "dup_of 'pending-normalizer' depends on worker normalize rules, fill in once decided",
    }

    # 7. Semicolon + Windows-1252 (European Excel "CSV")
    semi = "URL;Titel;Datum\n" + "\n".join(
        f"https://fixture-blog-0{i}.com/seite-{i};Café Müller – Übersicht €{i};2026-10-0{i}"
        for i in range(1, 9)
    ) + "\n"
    write("edge_semicolon_cp1252.csv", semi.encode("cp1252"))
    manifest["files"]["edge_semicolon_cp1252.csv"] = {
        "shape": "european excel", "encoding": "cp1252", "bom": False, "delimiter": ";",
        "header_line": 1, "url_column": "URL", "data_records": 8,
        "notes": "not valid UTF-8, so encoding must be detected, not assumed",
    }

    # 8. Preamble lines before the header
    pre = (
        "Report generated by fixture tool\nDomain: rival-fixture.com\n\n"
        "Source url,Source title,Anchor\n"
        + "\n".join(f"https://fixture-guide-07.com/p{i},Title {i},anchor {i}" for i in range(1, 9))
        + "\n"
    )
    write("edge_preamble_header.csv", encode(pre, "utf-8", False))
    manifest["files"]["edge_preamble_header.csv"] = {
        "shape": "edge cases", "encoding": "utf-8", "bom": False, "delimiter": ",",
        "header_line": 4, "url_column": "Source url", "data_records": 8,
        "notes": "header is line 4, lines 1-3 are a preamble and a blank line",
    }

    # 9. Duplicate and blank header names
    dup = (
        "URL,URL,Title,,Notes\n"
        + "\n".join(f"https://fixture-tech-08.org/a{i},https://alt.example/{i},T{i},x,n" for i in range(1, 6))
        + "\n"
    )
    write("edge_duplicate_headers.csv", encode(dup, "utf-8", False))
    manifest["files"]["edge_duplicate_headers.csv"] = {
        "shape": "edge cases", "encoding": "utf-8", "bom": False, "delimiter": ",",
        "header_line": 1, "url_column": "URL (first of two)", "data_records": 5,
        "notes": "two columns named URL and one blank header. Header-text-only mapping cannot pick one, mapping needs the column index",
    }

    # 10-11. Headers only, empty
    write("edge_headers_only.csv", encode("url,title\n", "utf-8", False))
    manifest["files"]["edge_headers_only.csv"] = {
        "shape": "edge cases", "encoding": "utf-8", "bom": False, "delimiter": ",",
        "header_line": 1, "url_column": "url", "data_records": 0, "notes": "header, no rows",
    }
    write("edge_empty.csv", b"")
    manifest["files"]["edge_empty.csv"] = {
        "shape": "edge cases", "encoding": "n/a", "bom": False, "delimiter": "n/a",
        "header_line": None, "url_column": None, "data_records": 0,
        "notes": "0 bytes. The upload form refuses it, the worker must still cope",
    }

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


def decode(path: Path, meta) -> str:
    raw = path.read_bytes()
    enc = meta["encoding"]
    if enc == "n/a":
        return ""
    if meta.get("bom") and raw.startswith(BOMS[enc]):
        raw = raw[len(BOMS[enc]):]
    return raw.decode(enc)


def check():
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    bad = 0
    for name, meta in manifest["files"].items():
        text = decode(OUT / name, meta)
        if meta["encoding"] == "n/a":
            assert text == ""
            print(f"ok   {name}: empty")
            continue
        lines = text.splitlines() if "data_lines" in meta else None
        if lines is not None:
            got = len(lines) - meta["header_line"]
            want = meta["data_lines"]
        else:
            rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=meta["delimiter"]))
            rows = rows[meta["header_line"] - 1 :]
            rows = [r for r in rows if any(c.strip() for c in r)]
            got, want = len(rows) - 1, meta["data_records"]
        flag = "ok  " if got == want else "FAIL"
        bad += got != want
        print(f"{flag} {name}: records {got} (expected {want})")
    return bad


def big(n):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / f"big_{n // 1_000_000}m.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["url", "title"])
        for i in range(n):
            w.writerow([f"https://site{i % 50_000}.fixture-big.com/page/{i}", f"Title {i}"])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--big", type=int, default=0, help="also write a big file with N rows")
    ap.add_argument("--check", action="store_true", help="only re-parse files against manifest")
    a = ap.parse_args()
    if a.check:
        sys.exit(1 if check() else 0)
    build()
    if a.big:
        big(a.big)
    sys.exit(1 if check() else 0)