# Stock Market API (Rust) — minimal-latency container build.
# Multi-stage: static musl binary on a distroless-style runtime.
#
# Build:
#   docker build -t stock-market-api-rs ./apps/api-rs
# Run:
#   docker run -p 3000:3000 \
#     -e DATABASE_URL=postgresql://... \
#     -e VALKEY_URL=redis://... \
#     -e VALKEY_CACHE_PREFIX=stock-market:production \
#     -e SOURCE_BASE_URL=https://www.screener.in \
#     -e ENVIRONMENT=production \
#     stock-market-api-rs

FROM rust:1-bookworm AS builder
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends musl-tools ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Match the musl target to the build architecture (amd64/arm64).
RUN if [ "$TARGETARCH" = "arm64" ]; then echo aarch64-unknown-linux-musl > /tmp/musl-target; else echo x86_64-unknown-linux-musl > /tmp/musl-target; fi \
    && rustup target add "$(cat /tmp/musl-target)"
ENV CC_x86_64_unknown_linux_musl=musl-gcc \
    CC_aarch64_unknown_linux_musl=musl-gcc
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
# Cache dependency compilation before sources change.
RUN mkdir -p src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release --target "$(cat /tmp/musl-target)" \
    && rm -rf src
COPY src ./src
RUN cargo build --release --target "$(cat /tmp/musl-target)" \
    && strip "target/$(cat /tmp/musl-target)/release/api-rs" \
    && cp "target/$(cat /tmp/musl-target)/release/api-rs" /api-rs

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /api-rs /api-rs
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["/api-rs"]
