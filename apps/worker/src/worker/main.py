import asyncio
import functools
import re
import signal
import socket
import uuid

import structlog

from worker.config.settings import get_settings
from worker.db.pool import ensure_restricted_role, open_pool
from worker.engine.csv_runner import CsvRunner
from worker.engine.heartbeat import Heartbeat
from worker.engine.link_verifier import LinkVerifier
from worker.engine.loop import Engine, EngineConfig
from worker.engine.runner import JobRunner
from worker.engine.search import SearchRunner
from worker.engine.storage_cleanup import StorageCleanupRunner
from worker.fetch.fetcher import PoliteFetcher
from worker.io.storage import StorageClient
from worker.logging import setup_logging
from worker.providers.serper import SerperProvider
from worker.scoring.rescore import RescoreRunner
from worker.stages.opportunity import OpportunityHandler


async def run() -> None:
    s = get_settings()
    if s.search_enabled and not s.serper_api_key:
        raise ValueError("SERPER_API_KEY is required when SEARCH_ENABLED=true")
    if (s.site_crawl_enabled or s.link_verification_enabled) and (
        "example." in s.bot_user_agent or not re.search(r"\(\+https://[^\s)]+", s.bot_user_agent)
    ):
        raise ValueError("Set BOT_USER_AGENT to a real bot contact before enabling site crawl")
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
            await ensure_restricted_role(conn)
        log.info("worker_started")

        async with PoliteFetcher(pool=pool) as fetcher:
            handler = OpportunityHandler(
                pool, worker_id, fetcher, site_crawl_enabled=s.site_crawl_enabled
            )
            engine = Engine(pool, worker_id, EngineConfig.from_settings(s), handler, stop)
            csv_runner = CsvRunner(pool, s, stop, worker_id=worker_id)
            tasks = {
                "engine": asyncio.create_task(engine.run()),
                "csv_runner": asyncio.create_task(csv_runner.run()),
                "rescore": asyncio.create_task(RescoreRunner(pool, s.poll_seconds, stop).run()),
                "storage_cleanup": asyncio.create_task(
                    StorageCleanupRunner(
                        pool,
                        StorageClient(s.supabase_url, s.supabase_service_role_key)
                        if s.supabase_url and s.supabase_service_role_key
                        else None,
                        s.poll_seconds,
                        stop,
                    ).run()
                ),
            }
            if s.runner_enabled:
                runner = JobRunner(pool, s.poll_seconds, stop)
                tasks["runner"] = asyncio.create_task(runner.run())
            else:
                log.warning("job_runner_disabled", detail="set RUNNER_ENABLED=true to enable")
            if s.link_verification_enabled:
                tasks["link_verifier"] = asyncio.create_task(
                    LinkVerifier(pool, fetcher, worker_id, stop, s.poll_seconds).run()
                )
            if s.search_enabled:

                async def run_search() -> None:
                    async with SerperProvider(s.serper_api_key) as provider:
                        await SearchRunner(
                            pool,
                            provider,
                            worker_id,
                            stop,
                            s.poll_seconds,
                            s.lease_seconds,
                            s.max_attempts,
                        ).run()

                tasks["search"] = asyncio.create_task(run_search())
            else:
                log.info("search_disabled", detail="set SEARCH_ENABLED=true to enable paid search")

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
                try:
                    await asyncio.wait_for(stop.wait(), timeout=s.heartbeat_seconds)
                except TimeoutError:
                    pass
            await stop.wait()
            await asyncio.gather(*tasks.values())  # re-raises if one crashed
    log.info("worker_stopped")
