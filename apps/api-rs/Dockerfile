# Multi-platform production image (linux/amd64 + linux/arm64).
# Build a static musl executable for the same architecture as the target image.
ARG TARGETARCH
FROM --platform=$BUILDPLATFORM messense/rust-musl-cross:${TARGETARCH}-musl AS builder
WORKDIR /build
ARG TARGETARCH

COPY Cargo.toml Cargo.lock ./
COPY src ./src
ENV CARGO_BUILD_JOBS=1
RUN case "$TARGETARCH" in \
      amd64) rust_target=x86_64-unknown-linux-musl ;; \
      arm64) rust_target=aarch64-unknown-linux-musl ;; \
      *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && cargo build --locked --release --target "$rust_target" \
    && musl-strip "target/$rust_target/release/api-rs" \
    && test -x "target/$rust_target/release/api-rs" \
    && if readelf -l "target/$rust_target/release/api-rs" | grep -q 'Requesting program interpreter'; then echo 'Rust API binary is dynamically linked' >&2; exit 1; fi \
    && install -D "target/$rust_target/release/api-rs" /out/api-rs

FROM scratch
COPY --from=builder /out/api-rs /api-rs
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENV PORT=3000 \
    ENVIRONMENT=production \
    RUST_LOG=info
EXPOSE 3000
USER 65532:65532
ENTRYPOINT ["/api-rs"]
