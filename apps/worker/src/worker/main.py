import asyncio
import signal
import socket
import uuid

import structlog

from worker.config.settings import get_settings
from worker.db.pool import open_pool
from worker.logging import setup_logging


async def run() -> None:
    s = get_settings()
    setup_logging(s.log_level)
    worker_id = f"{socket.gethostname()}-{uuid.uuid4().hex[:6]}"
    structlog.contextvars.bind_contextvars(worker_id=worker_id)
    log = structlog.get_logger()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    async with open_pool(s.database_url) as pool:
        async with pool.connection() as conn:
            await conn.execute("select 1")
        log.info("worker_started")
        while not stop.is_set():
            log.info("heartbeat")  # real heartbeat table arrives in M3
            try:
                await asyncio.wait_for(stop.wait(), timeout=s.heartbeat_seconds)
            except TimeoutError:
                pass
    log.info("worker_stopped")
