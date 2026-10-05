# Multi-platform production image (linux/amd64 + linux/arm64).
# Release binary, stripped, running as non-root on a minimal glibc runtime.
FROM --platform=$BUILDPLATFORM rust:1-bookworm AS builder
WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --locked --release \
    && strip target/release/api-rs \
    && install -D target/release/api-rs /out/api-rs

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder --chown=nonroot:nonroot /out/api-rs /api-rs
ENV PORT=3000 \
    ENVIRONMENT=production \
    DB_POOL_MAX=5 \
    RUST_LOG=info
EXPOSE 3000
USER nonroot:nonroot
ENTRYPOINT ["/api-rs"]
