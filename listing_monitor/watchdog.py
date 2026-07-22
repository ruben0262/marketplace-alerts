from __future__ import annotations

import logging
import os
import threading
import time

LOGGER = logging.getLogger(__name__)


class Heartbeat:
    """Force-exit the process when the main loop stops making progress.

    A stuck native call (for example a wedged curl_cffi TLS handshake through a
    proxy) can block the asyncio event-loop thread. When that happens no Python
    timeout or task cancellation can run, so the monitor freezes silently. This
    watchdog lives in its own OS thread: if ``beat`` is not called within
    ``stall_timeout`` seconds it terminates the process, letting the container's
    restart policy start a fresh one with clean sessions.
    """

    def __init__(self, stall_timeout: float, *, check_interval: float = 30.0) -> None:
        self._stall_timeout = stall_timeout
        self._check_interval = check_interval
        self._last_beat = time.monotonic()
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._watch, name="heartbeat", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def beat(self) -> None:
        with self._lock:
            self._last_beat = time.monotonic()

    def _watch(self) -> None:
        while True:
            time.sleep(self._check_interval)
            with self._lock:
                idle = time.monotonic() - self._last_beat
            if idle > self._stall_timeout:
                LOGGER.error(
                    "No polling progress for %.0fs (limit %.0fs); forcing restart",
                    idle,
                    self._stall_timeout,
                )
                os._exit(1)
                return  # unreachable in production; lets tests stub os._exit
