from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from psycopg_pool import AsyncConnectionPool


@asynccontextmanager
async def open_pool(url: str) -> AsyncIterator[AsyncConnectionPool]:
    pool = AsyncConnectionPool(url, min_size=1, max_size=5, open=False)
    await pool.open(wait=True)
    try:
        yield pool
    finally:
        await pool.close()
