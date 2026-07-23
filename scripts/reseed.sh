#!/usr/bin/env sh
set -eu

POINT_COUNT="${POINT_COUNT:-250000}"
LINE_COUNT="${LINE_COUNT:-50000}"
POLYGON_COUNT="${POLYGON_COUNT:-10000}"
VERTICES="${VERTICES:-16}"

docker compose exec -T postgis psql \
  --username benchmark \
  --dbname benchmark \
  --set ON_ERROR_STOP=1 \
  --command "CALL benchmark.seed(${POINT_COUNT}, ${LINE_COUNT}, ${POLYGON_COUNT}, ${VERTICES}); CALL benchmark.seed_spread_profile('r3', 3, ${POINT_COUNT}, ${LINE_COUNT}, ${POLYGON_COUNT}, ${VERTICES}); CALL benchmark.seed_spread_profile('r30', 30, ${POINT_COUNT}, ${LINE_COUNT}, ${POLYGON_COUNT}, ${VERTICES}); CALL benchmark.seed_spread_profile('r150', 150, ${POINT_COUNT}, ${LINE_COUNT}, ${POLYGON_COUNT}, ${VERTICES});"
