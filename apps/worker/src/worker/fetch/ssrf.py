from __future__ import annotations

import asyncio
import ipaddress
import socket
from typing import Protocol
from urllib.parse import urlsplit

from worker.fetch.types import DNSResolutionError, SSRFBlockedError

BLOCKED_IPV4_NETWORKS: tuple[ipaddress.IPv4Network, ...] = (
    ipaddress.IPv4Network("0.0.0.0/8"),  # Current network (RFC 791)
    ipaddress.IPv4Network("10.0.0.0/8"),  # Private-use (RFC 1918)
    ipaddress.IPv4Network("100.64.0.0/10"),  # Shared Address / Carrier-grade NAT (RFC 6598)
    ipaddress.IPv4Network("127.0.0.0/8"),  # Loopback (RFC 1122)
    ipaddress.IPv4Network("169.254.0.0/16"),  # Link-Local (RFC 3927) & Cloud Metadata
    ipaddress.IPv4Network("172.16.0.0/12"),  # Private-use (RFC 1918)
    ipaddress.IPv4Network("192.0.0.0/24"),  # IETF Protocol Assignments (RFC 6890)
    ipaddress.IPv4Network("192.0.2.0/24"),  # TEST-NET-1 (RFC 5737)
    ipaddress.IPv4Network("192.88.99.0/24"),  # 6to4 Relay (RFC 7526)
    ipaddress.IPv4Network("192.168.0.0/16"),  # Private-use (RFC 1918)
    ipaddress.IPv4Network("198.18.0.0/15"),  # Benchmarking (RFC 2544)
    ipaddress.IPv4Network("198.51.100.0/24"),  # TEST-NET-2 (RFC 5737)
    ipaddress.IPv4Network("203.0.113.0/24"),  # TEST-NET-3 (RFC 5737)
    ipaddress.IPv4Network("224.0.0.0/4"),  # Multicast (RFC 5771)
    ipaddress.IPv4Network("240.0.0.0/4"),  # Reserved for future use (RFC 1112)
    ipaddress.IPv4Network("255.255.255.255/32"),  # Broadcast
)

BLOCKED_IPV6_NETWORKS: tuple[ipaddress.IPv6Network, ...] = (
    ipaddress.IPv6Network("::/128"),  # Unspecified
    ipaddress.IPv6Network("::1/128"),  # Loopback
    ipaddress.IPv6Network("::ffff:0:0/96"),  # IPv4-mapped
    ipaddress.IPv6Network("64:ff9b::/96"),  # IPv4/IPv6 translation (RFC 6052)
    ipaddress.IPv6Network("64:ff9b:1::/48"),  # Local-use translation (RFC 8215)
    ipaddress.IPv6Network("100::/64"),  # Discard-only (RFC 6666)
    ipaddress.IPv6Network("2001::/23"),  # IETF Protocol Assignments
    ipaddress.IPv6Network("2001:db8::/32"),  # Documentation (RFC 3849)
    ipaddress.IPv6Network("2002::/16"),  # 6to4
    ipaddress.IPv6Network("fc00::/7"),  # Unique Local Address (RFC 4193)
    ipaddress.IPv6Network("fe80::/10"),  # Link-Local Unicast (RFC 4291)
    ipaddress.IPv6Network("ff00::/8"),  # Multicast (RFC 4291)
)

ALLOWED_SCHEMES: frozenset[str] = frozenset({"http", "https"})
ALLOWED_PORTS: frozenset[int] = frozenset({80, 443})


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Check if an IP address falls within private, loopback, link-local,
    or cloud metadata ranges.
    """
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return True

    if isinstance(ip, ipaddress.IPv4Address):
        for v4_net in BLOCKED_IPV4_NETWORKS:
            if ip in v4_net:
                return True
    elif isinstance(ip, ipaddress.IPv6Address):
        # Handle IPv4-mapped IPv6 address (::ffff:x.x.x.x)
        if ip.ipv4_mapped is not None:
            return is_ip_blocked(ip.ipv4_mapped)

        # Handle 6to4 (2002::/16 embedded IPv4)
        if ip in ipaddress.IPv6Network("2002::/16"):
            embedded_ipv4 = ipaddress.IPv4Address(ip.packed[2:6])
            if is_ip_blocked(embedded_ipv4):
                return True

        # Cloud metadata IPv6 (e.g., AWS IMDSv6 fd00:ec2::254)
        if str(ip).lower() == "fd00:ec2::254":
            return True

        for v6_net in BLOCKED_IPV6_NETWORKS:
            if ip in v6_net:
                return True

    return False


class DNSResolver(Protocol):
    """Protocol for resolving hostnames to IP addresses asynchronously."""

    async def resolve(
        self, host: str, port: int
    ) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]: ...


class SystemDNSResolver:
    """Default DNS resolver using asyncio's event loop getaddrinfo."""

    async def resolve(
        self, host: str, port: int
    ) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        clean_host = host.strip("[]")
        # Check if already a literal IP
        try:
            ip = ipaddress.ip_address(clean_host)
            return [ip]
        except ValueError:
            pass

        loop = asyncio.get_running_loop()
        try:
            addr_info = await loop.getaddrinfo(
                clean_host,
                port,
                type=socket.SOCK_STREAM,
                proto=socket.IPPROTO_TCP,
            )
        except (socket.gaierror, OSError) as err:
            raise DNSResolutionError(f"DNS resolution failed for {clean_host}: {err}") from err

        ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
        for _family, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            try:
                ips.append(ipaddress.ip_address(ip_str))
            except ValueError:
                continue

        if not ips:
            raise DNSResolutionError(f"No IP addresses resolved for {clean_host}")
        return ips


async def validate_target_url(
    url: str,
    resolver: DNSResolver | None = None,
) -> tuple[str, int, list[ipaddress.IPv4Address | ipaddress.IPv6Address]]:
    """Validate URL for SSRF vulnerabilities: scheme, port, and resolved IPs.

    Returns (host, port, resolved_ips).
    Raises SSRFBlockedError if scheme/port is disallowed or resolved IP is in a blocked range.
    Raises DNSResolutionError if host cannot be resolved.
    """
    try:
        parts = urlsplit(url.strip())
    except Exception as err:
        raise SSRFBlockedError(f"Malformed URL: {url}") from err

    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise SSRFBlockedError(f"Scheme {scheme!r} not allowed. Only http and https are permitted.")

    host = parts.hostname
    if not host:
        raise SSRFBlockedError(f"Missing host in URL: {url}")

    try:
        port = parts.port
    except ValueError as err:
        raise SSRFBlockedError(f"Invalid port in URL: {url}") from err
    if port is None:
        port = 80 if scheme == "http" else 443

    if port not in ALLOWED_PORTS:
        raise SSRFBlockedError(f"Port {port} not allowed. Only ports 80 and 443 are permitted.")

    dns = resolver or SystemDNSResolver()
    clean_host = host.strip("[]")
    try:
        literal_ip = ipaddress.ip_address(clean_host)
        resolved_ips = [literal_ip]
    except ValueError:
        resolved_ips = await dns.resolve(host, port)

    if not resolved_ips:
        raise DNSResolutionError(f"No IP addresses resolved for {host}")

    for ip in resolved_ips:
        if is_ip_blocked(ip):
            raise SSRFBlockedError(f"URL {url} resolves to blocked IP address {ip}.")

    return host, port, resolved_ips
