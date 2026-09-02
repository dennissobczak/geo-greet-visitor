/**
 * IP parsing for the offline country table.
 *
 * Only what the lookup needs: an IPv4 address as a 32-bit number, an IPv6
 * address as the top 32 bits of its prefix (the granularity registries hand
 * address space out at), and a test for addresses that can never belong to a
 * country.
 */

/** An address the table can be searched with. */
export type ParsedIp =
  | { version: 4; value: number }
  | { version: 6; key: number; groups: number[] };

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET_PATTERN = /^[0-9a-f]{1,4}$/i;

/**
 * Parses dotted-quad IPv4 into a number. Multiplication rather than `<<` keeps
 * the result unsigned - `1 << 31` would come back negative.
 */
export function parseIpv4(ip: string): number | null {
  const match = IPV4_PATTERN.exec(ip);
  if (!match) return null;

  let value = 0;
  for (let i = 1; i <= 4; i += 1) {
    const octet = Number(match[i]);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Expands an IPv6 address into its eight hextets, or `null` if malformed. */
function parseIpv6Groups(ip: string): number[] | null {
  let text = ip.trim();

  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);

  // Scope id, e.g. fe80::1%eth0.
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  if (!text.includes(":")) return null;

  // A trailing dotted quad (::ffff:203.0.113.9) stands in for the last two
  // hextets - rewrite it as hex so the rest of the parse is uniform.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const embedded = parseIpv4(tail);
    if (embedded === null) return null;
    text =
      text.slice(0, lastColon + 1) +
      Math.floor(embedded / 65536).toString(16) +
      ":" +
      (embedded % 65536).toString(16);
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];

  let parts: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 0) return null;
    parts = [...head, ...new Array<string>(fill).fill("0"), ...rest];
  } else {
    parts = head;
  }
  if (parts.length !== 8) return null;

  const groups: number[] = [];
  for (const part of parts) {
    if (!HEXTET_PATTERN.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  return groups;
}

/**
 * Parses either IP family. IPv4-mapped IPv6 (`::ffff:203.0.113.9`) is folded
 * back to IPv4 - proxies hand those out for plain IPv4 clients, and the country
 * lives in the IPv4 table.
 */
export function parseIp(ip: string): ParsedIp | null {
  const trimmed = ip.trim();

  const v4 = parseIpv4(trimmed);
  if (v4 !== null) return { version: 4, value: v4 };

  const groups = parseIpv6Groups(trimmed);
  if (!groups) return null;

  const mapped =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;
  if (mapped) return { version: 4, value: groups[6] * 65536 + groups[7] };

  return { version: 6, key: groups[0] * 65536 + groups[1], groups };
}

/** `[first, last]` of each IPv4 block that belongs to no country. */
const PRIVATE_V4: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8      this network
  [0x0a000000, 0x0affffff], // 10.0.0.0/8     private
  [0x64400000, 0x647fffff], // 100.64.0.0/10  carrier-grade NAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8    loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local
  [0xac100000, 0xac1fffff], // 172.16.0.0/12  private
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24   IETF protocol assignments
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24   documentation
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 private
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15  benchmarking
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24 documentation
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 documentation
  [0xe0000000, 0xffffffff], // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
];

/**
 * True for addresses that cannot be geolocated at all: loopback and private
 * ranges, link-local, documentation blocks, multicast. In local development
 * every request lands here, which is what makes the greeting fall back to
 * "the world" instead of guessing.
 */
export function isPrivate(parsed: ParsedIp): boolean {
  if (parsed.version === 4) {
    return PRIVATE_V4.some(([first, last]) => parsed.value >= first && parsed.value <= last);
  }

  const [g0] = parsed.groups;

  // :: (unspecified) and ::1 (loopback)
  if (parsed.groups.every((group, i) => (i === 7 ? group <= 1 : group === 0))) return true;
  // fc00::/7 unique local
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfe80) return true;
  // ff00::/8 multicast
  if ((g0 & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 documentation
  if (g0 === 0x2001 && parsed.groups[1] === 0x0db8) return true;

  return false;
}
