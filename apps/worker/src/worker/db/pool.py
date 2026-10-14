from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from psycopg_pool import AsyncConnectionPool


@asynccontextmanager
async def open_pool(url: str, max_size: int = 5) -> AsyncIterator[AsyncConnectionPool]:
    pool = AsyncConnectionPool(url, min_size=1, max_size=max_size, open=False)
    await pool.open(wait=True)
    try:
        yield pool
    finally:
        await pool.close()
