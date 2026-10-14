import asyncio
import functools
import signal
import socket
import uuid

import structlog

from worker.config.settings import get_settings
from worker.db.pool import open_pool
from worker.engine.heartbeat import Heartbeat
from worker.engine.loop import Engine, EngineConfig
from worker.engine.runner import JobRunner
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

    async with open_pool(s.database_url, max_size=s.pool_max_size) as pool:
        async with pool.connection() as conn:
            await conn.execute("select 1")
        log.info("worker_started")

        # handler=None until M5 wires the check pipeline: reaps, never claims.
        engine = Engine(pool, worker_id, EngineConfig.from_settings(s), None, stop)
        runner = JobRunner(pool, s.poll_seconds, stop)
        tasks = {"engine": asyncio.create_task(engine.run())}
        if s.runner_enabled:
            runner = JobRunner(pool, s.poll_seconds, stop)
            tasks["runner"] = asyncio.create_task(runner.run())
        else:
            log.warning("job_runner_disabled", detail="set RUNNER_ENABLED=true to enable")

        def _on_done(name: str, t: asyncio.Task[None]) -> None:
            if not t.cancelled() and t.exception() is not None:
                log.error("background_task_crashed", task=name)
                stop.set()

        for name, task in tasks.items():
            task.add_done_callback(functools.partial(_on_done, name))
        tasks["heartbeat"] = asyncio.create_task(
            Heartbeat(pool, worker_id, socket.gethostname(), s.heartbeat_seconds, stop).run()
        )

        while not stop.is_set():
            log.info("heartbeat")  # heartbeat table arrives in M3-S9
            try:
                await asyncio.wait_for(stop.wait(), timeout=s.heartbeat_seconds)
            except TimeoutError:
                pass
        await stop.wait()
        await asyncio.gather(*tasks.values())  # re-raises if one crashed
    log.info("worker_stopped")
