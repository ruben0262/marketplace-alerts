FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md LICENSE ./
COPY listing_monitor ./listing_monitor

RUN python -m pip install --no-cache-dir . \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /app/data \
    && chown app:app /app/data

USER app

# Unhealthy when the monitor has not refreshed data/heartbeat within 600s, i.e. the
# event loop is wedged. An autoheal sidecar restarts the container on this signal.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD test "$(( $(date +%s) - $(stat -c %Y /app/data/heartbeat 2>/dev/null || echo 0) ))" -lt 600

CMD ["python", "-m", "listing_monitor", "--config", "/app/config.yaml"]

