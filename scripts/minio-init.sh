#!/bin/sh
# Create the four buckets (HLA §5). Idempotent — safe on every `compose up`.
set -eu

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

for bucket in myflix-source myflix-media myflix-images myflix-staging; do
  mc mb --ignore-existing "local/$bucket"
done

# Nothing is public: nginx holds the only credential path to media/images,
# and it verifies the secure_link signature before proxying (ADR-006).
for bucket in myflix-source myflix-media myflix-images myflix-staging; do
  mc anonymous set none "local/$bucket"
done

# Staging holds per-job scratch. Anything older than a day is a failed job's
# debris; expire it rather than growing the bucket forever (risk R-5).
mc ilm rule add --expire-days 1 local/myflix-staging 2>/dev/null \
  || echo "staging expiry rule already present"

echo "buckets ready:"
mc ls local
