# syntax=docker/dockerfile:1

# ---- build ----
FROM rust:1.90-bookworm AS builder
WORKDIR /build

# Cache dependency compilation: build against a stub main first, then the real
# sources. If only src/ changes, the dependency layer is reused.
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -rf src

COPY src ./src
# Touch so cargo recompiles the real binary (stub had the same path).
RUN touch src/main.rs && cargo build --release

# Run the unit tests as part of the image build so a broken build fails here.
RUN cargo test --release

# ---- runtime ----
FROM debian:bookworm-slim AS runtime

# ffprobe (ffmpeg) for specs/decoding fallbacks; fpcalc (libchromaprint-tools)
# for Chromaprint fingerprints; ca-certificates for TLS to AcoustID.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libchromaprint-tools \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user; the completed-downloads mount is read-only anyway.
RUN useradd --system --uid 10001 --home-dir /nonexistent --no-create-home verifier \
    && mkdir -p /state \
    && chown verifier:verifier /state

COPY --from=builder /build/target/release/shufflerr-verifier /usr/local/bin/shufflerr-verifier

USER verifier
ENV RUST_LOG=info \
    DRY_RUN=true \
    COMPLETED_ROOT=/completed \
    STATE_DIR=/state
VOLUME ["/state"]

ENTRYPOINT ["/usr/local/bin/shufflerr-verifier"]
