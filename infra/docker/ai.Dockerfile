# Python AI engine: one image, two commands (`vidyam-ai serve` for the internal API, `vidyam-ai worker`).
# Build context: repository root.
ARG PYTHON_IMAGE=python:3.12.13-slim-bookworm

FROM ${PYTHON_IMAGE} AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.2 /uv /bin/uv
# Build the virtualenv at its final path: launchers (e.g. bin/vidyam-ai) embed the interpreter's absolute path.
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /repo
# Dependencies first (cached until uv.lock changes), then the engine itself, installed non-editable.
COPY pyproject.toml uv.lock .python-version ./
COPY apps/ai/pyproject.toml apps/ai/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --package vidyam-ai --no-dev --no-install-workspace
COPY apps/ai apps/ai
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --package vidyam-ai --no-dev --no-editable

FROM ${PYTHON_IMAGE} AS runtime
RUN useradd --create-home --uid 1000 vidyam
COPY --from=builder --chown=vidyam:vidyam /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH VIDYAM_AI_HOST=0.0.0.0 VIDYAM_AI_PORT=38120 PYTHONUNBUFFERED=1
USER vidyam
EXPOSE 38120
CMD ["vidyam-ai", "serve"]
