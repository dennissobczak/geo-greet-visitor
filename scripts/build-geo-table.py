#!/usr/bin/env python3
"""
Regenerates src/geo/data.ts - the offline IP-to-country table.

    python3 scripts/build-geo-table.py            # download + write the table
    python3 scripts/build-geo-table.py --stats    # sweep the size/accuracy knobs
    python3 scripts/build-geo-table.py --offline  # reuse a previous download

This is a maintainer tool, not part of `npm run build`: the generated file is
committed, so consumers never run it. It is Python because it needs no
dependencies beyond the standard library - the package itself stays pure
TypeScript.

Source data
-----------
The five regional internet registries publish a daily "delegated extended"
file listing every allocation they have made, with the country it was
delegated to. Those files are the public record of who holds which addresses
and are free to use and redistribute with no attribution or share-alike terms
- unlike MaxMind GeoLite2 (CC BY-SA 4.0 + account) or DB-IP Lite (CC BY 4.0),
which is why they are the right source for an MIT-licensed package.

Only APNIC states a condition, in a comment header on its own file: the data
is free to download and use provided APNIC is not held responsible for any
loss or damage arising from it. No fee, no account, no attribution.

Accuracy
--------
Registry data says which country an allocation was *delegated* to, which is a
coarser truth than a commercial geolocation database: a pan-European ISP may
route a Dutch-delegated block to customers in three countries. That is the
accuracy this library promises - a rough estimate, good enough to greet
someone by their country, not a substitute for a real geo-IP service.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone

REGISTRIES = {
    "afrinic": "https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-extended-latest",
    "apnic": "https://ftp.apnic.net/apnic/stats/apnic/delegated-apnic-extended-latest",
    "arin": "https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest",
    "lacnic": "https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-extended-latest",
    "ripencc": "https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest",
}

# Tuning. Run --stats to reproduce the curve these were picked from:
#
#   min block   ranges     KB   error %
#        none   138668    679      0.00
#         /22    89522    473      0.41
#         /20    33777    189      2.14
#         /18    21744    191      4.70
#
# MIN_V4_BLOCK  - IPv4 ranges smaller than this are absorbed into the
#                 neighbouring range. Left at 1 (no absorption): the error a
#                 threshold buys is small in aggregate but lands on exactly the
#                 blocks people notice, because heavily fragmented /24 space is
#                 also the most used. At /22 the well-known 1.1.1.0/24 (AU) is
#                 swallowed by its Thai neighbour. Raise it if 470 KB of table
#                 matters more to you than that.
# MAX_GAP       - two ranges of the same country separated by a gap no larger
#                 than this are merged across it. Gaps are unallocated space,
#                 so this cannot mislabel any real address - it only means an
#                 unassigned IP resolves to its neighbours' country instead of
#                 to nothing.
MIN_V4_BLOCK = 1
MAX_V4_GAP = 4096
MAX_V6_GAP = 16

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
COUNTRY_PATTERN = re.compile(r"^[A-Z]{2}$")
OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "geo", "data.ts")


# --- source data -----------------------------------------------------------


def fetch(cache_dir: str, offline: bool) -> dict[str, str]:
    os.makedirs(cache_dir, exist_ok=True)
    files = {}
    for name, url in REGISTRIES.items():
        path = os.path.join(cache_dir, f"{name}.txt")
        if not (offline and os.path.exists(path)):
            print(f"  fetching {name}", file=sys.stderr)
            with urllib.request.urlopen(url, timeout=180) as response:
                data = response.read()
            with open(path, "wb") as fh:
                fh.write(data)
        files[name] = path
    return files


def parse(files: dict[str, str]) -> tuple[list, list]:
    """Reads the registry files into [start, end, country] ranges.

    IPv4 ranges are address numbers. IPv6 ranges are keyed on the top 32 bits
    of the prefix: registries allocate to LIRs at /19 to /32, so those bits
    identify the holder while keeping the table a fraction of its full size.
    """
    v4, v6 = [], []
    for path in files.values():
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                parts = line.rstrip("\n").split("|")
                if len(parts) < 7:
                    continue
                _registry, cc, kind, start, value, _date, status = parts[:7]
                if status not in ("allocated", "assigned"):
                    continue
                if not COUNTRY_PATTERN.match(cc):
                    continue
                if kind == "ipv4":
                    try:
                        a, b, c, d = (int(x) for x in start.split("."))
                    except ValueError:
                        continue
                    first = (a << 24) + (b << 16) + (c << 8) + d
                    v4.append([first, first + int(value), cc])
                elif kind == "ipv6":
                    head = start.split("::")[0].split(":")
                    try:
                        key = (int(head[0] or "0", 16) << 16) + (
                            int(head[1], 16) if len(head) > 1 and head[1] else 0
                        )
                    except ValueError:
                        continue
                    prefix = int(value)
                    span = 1 if prefix >= 32 else 2 ** (32 - prefix)
                    v6.append([key, key + span, cc])
    return v4, v6


# --- shaping ---------------------------------------------------------------


def normalize(ranges: list) -> list:
    """Sorts, removes overlap, and merges adjacent ranges of the same country.

    Registries do publish overlapping records (a block re-delegated, or listed
    by two registries). The lookup binary-searches a partition, so overlap has
    to go: the earlier-starting record keeps the contested addresses.
    """
    ranges.sort(key=lambda r: (r[0], r[1]))
    out: list = []
    end = 0
    for start, stop, cc in ranges:
        start = max(start, end)
        if start >= stop:
            continue
        if out and out[-1][2] == cc and out[-1][1] == start:
            out[-1][1] = stop
        else:
            out.append([start, stop, cc])
        end = stop
    return out


def bridge_gaps(ranges: list, max_gap: int) -> list:
    """Merges same-country ranges separated by at most `max_gap` unallocated
    addresses. Costs nothing in accuracy - the gap belongs to no country."""
    out: list = []
    for start, stop, cc in ranges:
        if out and out[-1][2] == cc and start - out[-1][1] <= max_gap:
            out[-1][1] = stop
        else:
            out.append([start, stop, cc])
    return out


def absorb_small(ranges: list, minimum: int) -> list:
    """Folds ranges below `minimum` addresses into the preceding range when it
    is adjacent. Repeats until stable, since absorbing one range can make its
    neighbour adjacent to the next."""
    current = ranges
    while True:
        out: list = []
        changed = False
        for entry in current:
            start, stop, cc = entry
            big = stop - start >= minimum
            previous = out[-1] if out else None
            if not big and previous and previous[1] == start:
                previous[1] = stop
                changed = True
            elif previous and previous[2] == cc and previous[1] == start:
                previous[1] = stop
            else:
                out.append([start, stop, cc])
        current = out
        if not changed:
            return current


def shape(ranges: list, max_gap: int, minimum: int) -> list:
    return absorb_small(bridge_gaps(normalize(ranges), max_gap), minimum)


# --- encoding --------------------------------------------------------------


def encode_int(value: int) -> str:
    """Little-endian base-32 with a continuation flag in bit 6, so integers
    need no separator between them. Values are 32-bit at most: five chars."""
    assert value >= 0
    chars = []
    while True:
        chunk = value & 31
        value >>= 5
        chars.append(ALPHABET[chunk + (32 if value else 0)])
        if not value:
            return "".join(chars)


def encode(ranges: list, countries: list[str]) -> str:
    index = {cc: i for i, cc in enumerate(countries)}
    out, previous = [], 0
    for start, stop, cc in ranges:
        out.append(encode_int(start - previous))
        out.append(encode_int(stop - start))
        out.append(encode_int(index[cc]))
        previous = stop
    return "".join(out)


def country_order(*range_lists: list) -> list[str]:
    """Countries ordered by how many ranges they hold, so the most common ones
    get single-character indices."""
    counts: dict[str, int] = {}
    for ranges in range_lists:
        for _start, _stop, cc in ranges:
            counts[cc] = counts.get(cc, 0) + 1
    return sorted(counts, key=lambda cc: (-counts[cc], cc))


# --- reporting -------------------------------------------------------------


def mislabeled(shaped: list, truth: list) -> float:
    """Share of allocated address space whose country the shaping changed."""
    wrong = total = 0
    i = 0
    for start, stop, cc in truth:
        total += stop - start
        while i < len(shaped) and shaped[i][1] <= start:
            i += 1
        j = i
        while j < len(shaped) and shaped[j][0] < stop:
            lo, hi = max(start, shaped[j][0]), min(stop, shaped[j][1])
            if hi > lo and shaped[j][2] != cc:
                wrong += hi - lo
            j += 1
    return wrong / total * 100 if total else 0.0


def stats(v4: list, v6: list) -> None:
    truth4 = [list(r) for r in normalize([list(r) for r in v4])]
    print(f"{'min block':>10} {'max gap':>9} {'ranges':>9} {'KB':>7} {'error %':>9}")
    for minimum in (1, 256, 1024, 4096):
        for gap in (0, 1024, 4096, 65536):
            shaped = shape([list(r) for r in v4], gap, minimum)
            text = encode(shaped, country_order(shaped))
            label = "none" if minimum == 1 else f"/{32 - minimum.bit_length() + 1}"
            print(
                f"{label:>10} {gap:>9} {len(shaped):>9} {len(text) / 1024:>7.0f}"
                f" {mislabeled(shaped, truth4):>9.2f}"
            )
    print()
    for gap in (0, 4, 16, 256):
        shaped = shape([list(r) for r in v6], gap, 1)
        text = encode(shaped, country_order(shaped))
        print(f"ipv6 gap {gap:>4}: {len(shaped):>7} ranges, {len(text) / 1024:>6.0f} KB")


# --- output ----------------------------------------------------------------


TEMPLATE = '''// Generated by scripts/build-geo-table.py - do not edit by hand.
//
// Source: the five regional internet registries' "delegated extended"
// statistics files (afrinic, apnic, arin, lacnic, ripencc), which record the
// country each block of address space was delegated to. That data is public
// and free to redistribute with no attribution or share-alike obligation.
//
// Snapshot taken {generated}.
//
// Encoding: three integers per range - the gap since the previous range ended,
// the range length, and an index into COUNTRIES - written little-endian in
// base 32, one character per 5 bits, with bit 6 set on every character but a
// value's last. See decode() in ./table.ts.

/** ISO 3166-1 alpha-2 codes, two characters each, most common first. */
export const COUNTRIES =
  "{countries}";

/** IPv4 ranges as address numbers. */
export const IPV4_RANGES =
  "{ipv4}";

export const IPV4_COUNT = {ipv4_count};

/** IPv6 ranges keyed on the top 32 bits of the prefix. */
export const IPV6_RANGES =
  "{ipv6}";

export const IPV6_COUNT = {ipv6_count};

/** Date of the registry snapshot the tables were built from (ISO 8601). */
export const GENERATED = "{generated}";
'''


def write(v4: list, v6: list) -> None:
    shaped4 = shape(v4, MAX_V4_GAP, MIN_V4_BLOCK)
    shaped6 = shape(v6, MAX_V6_GAP, 1)
    countries = country_order(shaped4, shaped6)

    # The decoder holds range bounds in a Uint32Array. A range ending at
    # 2**32 would wrap silently to 0 there, so fail here instead. Today the
    # top of the space (240.0.0.0/4) is reserved and never delegated.
    for label, shaped in (("IPv4", shaped4), ("IPv6", shaped6)):
        assert shaped[-1][1] <= 0xFFFFFFFF, f"{label} table overflows uint32"

    source = TEMPLATE.format(
        generated=datetime.now(timezone.utc).date().isoformat(),
        countries="".join(countries),
        ipv4=encode(shaped4, countries),
        ipv4_count=len(shaped4),
        ipv6=encode(shaped6, countries),
        ipv6_count=len(shaped6),
    )
    with open(OUTPUT, "w", encoding="utf-8") as fh:
        fh.write(source)

    print(
        f"wrote {os.path.relpath(OUTPUT)}: "
        f"{len(shaped4)} IPv4 + {len(shaped6)} IPv6 ranges, "
        f"{len(countries)} countries, {len(source) / 1024:.0f} KB"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stats", action="store_true", help="print the size/accuracy sweep")
    parser.add_argument("--offline", action="store_true", help="reuse a previous download")
    parser.add_argument(
        "--cache-dir",
        default=os.path.join(tempfile.gettempdir(), "geo-greet-visitor-rir"),
        help="where the registry files are downloaded to",
    )
    args = parser.parse_args()

    files = fetch(args.cache_dir, args.offline)
    v4, v6 = parse(files)
    print(f"parsed {len(v4)} IPv4 and {len(v6)} IPv6 records", file=sys.stderr)

    if args.stats:
        stats(v4, v6)
    else:
        write(v4, v6)


if __name__ == "__main__":
    main()
