#!/usr/bin/env bash
# Sandbox image'ını hazırlar (PHASE_1B).
#
# Image, agent'ın çalıştırdığı güvenilmeyen kodun içinde koştuğu ortamdır ve
# projelerin test setlerini koşabilmek için bir toolchain içermelidir
# (python3 + pytest, node + npm).
#
# İki yol vardır:
#   registry  — normal ortam: hazır bir image çekilir (varsayılan)
#   import    — kısıtlı ortam: registry'ye erişilemediğinde host'un kendi
#               rootfs'inden bir image üretilir
#
# Kullanım:
#   scripts/build-sandbox-image.sh            # registry yolu
#   scripts/build-sandbox-image.sh import     # host rootfs'inden üret
set -euo pipefail

IMAGE="${MC_SANDBOX_IMAGE:-mission-control/sandbox:local}"
MODE="${1:-registry}"

if ! docker info >/dev/null 2>&1; then
  echo "error: Docker daemon is not reachable." >&2
  echo "  Start Docker Desktop, or on Linux: sudo systemctl start docker" >&2
  exit 1
fi

case "$MODE" in
  registry)
    echo "Building $IMAGE from a registry base image…"
    docker build -t "$IMAGE" -f - . <<'DOCKERFILE'
FROM python:3.11-slim

# Test setlerini koşmak için gereken asgari toolchain.
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs npm \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir pytest

# Container non-root çalışır; workspace mount edildiğinde yazma izni
# host tarafında ayarlanır.
USER 65534:65534
WORKDIR /workspace
DOCKERFILE
    ;;

  import)
    # Kısıtlı ağ ortamları için: host'un kendi dosya sistemini image'a çevirir.
    # Avantajı, çalıştığı makinenin toolchain'iyle birebir uyumlu olmasıdır.
    # Dezavantajı büyük olması ve host'a bağımlı olmasıdır — üretim için
    # registry yolunu kullanın.
    echo "Building $IMAGE by importing the host root filesystem…"
    for tool in python3 node git; do
      command -v "$tool" >/dev/null || { echo "error: $tool not found on host" >&2; exit 1; }
    done
    tar -C / -c --numeric-owner \
      --exclude='./usr/share/doc' --exclude='./usr/share/man' \
      --exclude='./usr/share/locale' --exclude='./usr/src' \
      --exclude='./usr/share/icons' --exclude='./usr/lib/jvm' \
      ./bin ./sbin ./lib ./lib64 ./usr ./etc ./opt 2>/dev/null \
      | docker import -c 'ENV PATH=/usr/local/bin:/usr/bin:/bin:/opt/node22/bin' - "$IMAGE"
    ;;

  *)
    echo "usage: $0 [registry|import]" >&2
    exit 2
    ;;
esac

echo "Verifying toolchain inside $IMAGE…"
docker run --rm --network=none "$IMAGE" \
  python3 -c "import pytest; print('pytest', pytest.__version__)"
docker run --rm --network=none "$IMAGE" node -e "console.log('node', process.version)"
echo "OK: $IMAGE is ready."
