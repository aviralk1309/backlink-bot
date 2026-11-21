from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool


async def ensure_restricted_role(conn: AsyncConnection[Any]) -> None:
    row = await (
        await conn.execute(
            "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication "
            "from pg_roles where rolname = current_user"
        )
    ).fetchone()
    if row is None or any(row):
        raise RuntimeError("Worker database role has privileged attributes")


@asynccontextmanager
async def open_pool(url: str, max_size: int = 5) -> AsyncIterator[AsyncConnectionPool]:
    pool = AsyncConnectionPool(url, min_size=1, max_size=max_size, open=False)
    await pool.open(wait=True)
    try:
        yield pool
    finally:
        await pool.close()
