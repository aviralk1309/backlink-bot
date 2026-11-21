"""S-01: PostgREST must reject role promotion by a users.manage-only actor."""

import base64
import hashlib
import hmac
import json
import os
import subprocess
import time
import uuid
from pathlib import Path

import httpx
import psycopg
import pytest

pytestmark = pytest.mark.integration
ROOT = Path(__file__).resolve().parents[4]
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
ADMIN_ROLE = "a0000000-0000-0000-0000-000000000001"
VIEWER_ROLE = "a0000000-0000-0000-0000-000000000003"


def _local_status() -> dict[str, str]:
    result = subprocess.run(
        [
            "supabase",
            "--workdir",
            os.environ.get("TEST_SUPABASE_WORKDIR", str(ROOT)),
            "status",
            "--output",
            "env",
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=15,
    )
    return {
        key: value.strip('"')
        for line in result.stdout.splitlines()
        if "=" in line
        for key, value in [line.split("=", 1)]
    }


def _token(secret: str, subject: uuid.UUID) -> str:
    def encode(value: dict[str, object]) -> str:
        payload = json.dumps(value, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(payload).decode().rstrip("=")

    data = ".".join(
        [
            encode({"alg": "HS256", "typ": "JWT"}),
            encode(
                {
                    "sub": str(subject),
                    "role": "authenticated",
                    "aud": "authenticated",
                    "exp": int(time.time()) + 3600,
                }
            ),
        ]
    )
    signature = (
        base64.urlsafe_b64encode(hmac.new(secret.encode(), data.encode(), hashlib.sha256).digest())
        .decode()
        .rstrip("=")
    )
    return f"{data}.{signature}"


def test_s01_direct_postgrest_cannot_assign_admin_or_self_change() -> None:
    status = _local_status()
    role_id, actor_id, target_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(
            "insert into public.roles (id, name) values (%s, %s)",
            (role_id, f"S01 {role_id}"),
        )
        conn.execute(
            "insert into public.role_permissions (role_id, permission_key) "
            "values (%s, 'users.manage')",
            (role_id,),
        )
        conn.execute(
            "insert into auth.users (id, email) values (%s, %s), (%s, %s)",
            (actor_id, f"s01-{actor_id}@test.local", target_id, f"s01-{target_id}@test.local"),
        )
        conn.execute(
            "update public.profiles set status = 'active', role_id = %s where id = %s",
            (role_id, actor_id),
        )
        conn.execute(
            "update public.profiles set status = 'active', role_id = %s where id = %s",
            (VIEWER_ROLE, target_id),
        )

    headers = {
        "apikey": status["ANON_KEY"],
        "Authorization": f"Bearer {_token(status['JWT_SECRET'], actor_id)}",
        "Prefer": "return=representation",
    }
    try:
        with httpx.Client(timeout=10) as client:
            for user_id, new_role in ((target_id, ADMIN_ROLE), (actor_id, VIEWER_ROLE)):
                response = client.patch(
                    f"{status['API_URL']}/rest/v1/profiles",
                    params={"id": f"eq.{user_id}"},
                    headers=headers,
                    json={"role_id": new_role},
                )
                assert response.status_code == 403, response.text
        with psycopg.connect(ADMIN_URL) as conn:
            roles = dict(
                conn.execute(
                    "select id, role_id from public.profiles where id = any(%s)",
                    ([actor_id, target_id],),
                ).fetchall()
            )
            assert roles == {actor_id: role_id, target_id: uuid.UUID(VIEWER_ROLE)}
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
            conn.execute(
                "delete from public.profile_role_changes where profile_id = any(%s)",
                ([actor_id, target_id],),
            )
            conn.execute("delete from auth.users where id = any(%s)", ([actor_id, target_id],))
            conn.execute("delete from public.roles where id = %s", (role_id,))
