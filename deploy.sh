#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

BUCKET="rain.s8njee.com"
DISTRIBUTION_ID="E3C2DFFD50KSQ3"

echo "▸ Building..."
npm run build

ASSET_PATHS=()
if [ -d dist/assets ]; then
  while IFS= read -r asset; do
    ASSET_PATHS+=("/assets/$(basename "$asset")")
  done < <(find dist/assets -maxdepth 1 -type f)
fi

echo "▸ Uploading app shell..."
aws s3 cp dist/index.html "s3://${BUCKET}/index.html"

if [ -d dist/assets ]; then
  echo "▸ Syncing hashed app assets..."
  aws s3 sync dist/assets/ "s3://${BUCKET}/assets/" --delete
fi

echo "▸ Invalidating CloudFront..."
aws cloudfront create-invalidation \
  --distribution-id "${DISTRIBUTION_ID}" \
  --paths "/" "/index.html" "${ASSET_PATHS[@]}"

echo "✓ Deployed to ${BUCKET}"
