# syntax=docker/dockerfile:1
# The base image index supports native Linux amd64 and arm64; wheels supply the pinned Node runtime.
FROM python:3.11-slim-bookworm@sha256:a36c24f9cbdf4fd0f52d67f0823eeac19c2028c637cecc392d97f980d4fec56b AS install
ARG VERSION
COPY wheels/ /wheels/
COPY requirements.txt /requirements.txt
RUN python -m venv /opt/pio \
    && /opt/pio/bin/python -m pip install --no-cache-dir --no-index --find-links=/wheels "pio-agent-platformio==${VERSION}" \
    && /opt/pio/bin/python -m pip install --no-cache-dir --require-hashes --only-binary=:all: -r /requirements.txt

FROM python:3.11-slim-bookworm@sha256:a36c24f9cbdf4fd0f52d67f0823eeac19c2028c637cecc392d97f980d4fec56b
ARG VERSION
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.source="https://github.com/jl-codes/platformio-mcp" \
      org.opencontainers.image.title="PIO Agent" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.licenses="MIT"
COPY --from=install /opt/pio /opt/pio
RUN groupadd --gid 10001 pio \
    && useradd --uid 10001 --gid pio --create-home pio \
    && mkdir /workspace \
    && chown pio:pio /workspace
ENV PATH="/opt/pio/bin:${PATH}" \
    HOME="/home/pio" \
    PIO_MCP_NO_BROWSER="true"
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/opt/pio/bin/pio-agent"]
CMD ["--disable-dashboard"]
