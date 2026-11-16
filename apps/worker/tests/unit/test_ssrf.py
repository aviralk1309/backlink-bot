from __future__ import annotations

import ipaddress

import pytest

from worker.fetch.ssrf import (
    is_ip_blocked,
    validate_target_url,
)
from worker.fetch.types import DNSResolutionError, SSRFBlockedError


class DummyResolver:
    def __init__(self, ips: list[str]) -> None:
        self.ips = [ipaddress.ip_address(ip) for ip in ips]

    async def resolve(
        self, host: str, port: int
    ) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        return self.ips


class FailingResolver:
    async def resolve(
        self, host: str, port: int
    ) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        raise DNSResolutionError(f"NXDOMAIN for {host}")


@pytest.mark.unit
def test_blocked_ipv4_addresses() -> None:
    blocked = [
        "0.0.0.0",
        "0.1.2.3",
        "10.0.0.1",
        "10.255.255.255",
        "100.64.0.1",
        "100.127.255.255",
        "127.0.0.1",
        "127.1.2.3",
        "169.254.169.254",  # Cloud metadata
        "169.254.170.2",  # AWS ECS
        "172.16.0.1",
        "172.31.255.255",
        "192.0.0.1",
        "192.0.2.1",
        "192.88.99.1",
        "192.168.1.1",
        "192.168.100.50",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255",
    ]
    for ip_str in blocked:
        ip = ipaddress.ip_address(ip_str)
        assert is_ip_blocked(ip) is True, f"Expected {ip_str} to be blocked"


@pytest.mark.unit
def test_allowed_ipv4_addresses() -> None:
    allowed = [
        "93.184.216.34",  # example.com
        "8.8.8.8",
        "1.1.1.1",
        "142.250.190.46",  # google.com
    ]
    for ip_str in allowed:
        ip = ipaddress.ip_address(ip_str)
        assert is_ip_blocked(ip) is False, f"Expected {ip_str} to be allowed"


@pytest.mark.unit
def test_blocked_ipv6_addresses() -> None:
    blocked = [
        "::",
        "::1",
        "::ffff:127.0.0.1",  # IPv4-mapped loopback
        "::ffff:169.254.169.254",  # IPv4-mapped cloud metadata
        "::ffff:10.0.0.1",  # IPv4-mapped private
        "::ffff:192.168.1.1",  # IPv4-mapped private
        "2002:7f00:0001::",  # 6to4 embedding 127.0.0.1
        "2002:0a00:0001::",  # 6to4 embedding 10.0.0.1
        "2001:db8::1",  # Documentation
        "fc00::1",  # ULA
        "fd00::1",  # ULA
        "fd00:ec2::254",  # AWS IMDSv6
        "fe80::1",  # Link-local
        "ff02::1",  # Multicast
    ]
    for ip_str in blocked:
        ip = ipaddress.ip_address(ip_str)
        assert is_ip_blocked(ip) is True, f"Expected {ip_str} to be blocked"


@pytest.mark.unit
def test_allowed_ipv6_addresses() -> None:
    allowed = [
        "2606:4700:4700::1111",  # Cloudflare DNS
        "2001:4860:4860::8888",  # Google DNS
        "::ffff:93.184.216.34",  # IPv4-mapped public IP
    ]
    for ip_str in allowed:
        ip = ipaddress.ip_address(ip_str)
        assert is_ip_blocked(ip) is False, f"Expected {ip_str} to be allowed"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_validate_target_url_schemes() -> None:
    with pytest.raises(SSRFBlockedError, match="Scheme 'ftp' not allowed"):
        await validate_target_url("ftp://example.com/file")

    with pytest.raises(SSRFBlockedError, match="Scheme 'file' not allowed"):
        await validate_target_url("file:///etc/passwd")

    with pytest.raises(SSRFBlockedError, match="Scheme 'gopher' not allowed"):
        await validate_target_url("gopher://example.com")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_validate_target_url_ports() -> None:
    with pytest.raises(SSRFBlockedError, match="Port 8080 not allowed"):
        await validate_target_url("http://example.com:8080/test")

    with pytest.raises(SSRFBlockedError, match="Port 22 not allowed"):
        await validate_target_url("https://example.com:22/test")

    resolver = DummyResolver(["93.184.216.34"])
    # 80 and 443 are allowed
    host, port, _ = await validate_target_url("http://example.com:80/test", resolver=resolver)
    assert (host, port) == ("example.com", 80)

    host, port, _ = await validate_target_url("https://example.com:443/test", resolver=resolver)
    assert (host, port) == ("example.com", 443)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_validate_target_url_blocked_ips() -> None:
    # Direct IP literal in URL
    with pytest.raises(SSRFBlockedError, match="blocked IP address 127.0.0.1"):
        await validate_target_url("http://127.0.0.1/admin")

    with pytest.raises(SSRFBlockedError, match="blocked IP address 169.254.169.254"):
        await validate_target_url("http://169.254.169.254/latest/meta-data/")

    # Domain resolving to private IP
    resolver = DummyResolver(["10.0.0.5"])
    with pytest.raises(SSRFBlockedError, match="resolves to blocked IP address 10.0.0.5"):
        await validate_target_url("https://internal.corp/secret", resolver=resolver)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_validate_target_url_dns_failure() -> None:
    resolver = FailingResolver()
    with pytest.raises(DNSResolutionError, match="NXDOMAIN"):
        await validate_target_url("https://nonexistent-domain.xyz/page", resolver=resolver)
