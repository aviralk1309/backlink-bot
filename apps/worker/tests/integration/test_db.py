import pytest

from worker.config.settings import get_settings
from worker.db.pool import open_pool


@pytest.mark.integration
async def test_select_one() -> None:
    async with (
        open_pool(get_settings().database_url) as pool,
        pool.connection() as conn,
    ):
        cur = await conn.execute("select 1")
        assert (await cur.fetchone()) == (1,)
