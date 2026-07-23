CREATE OR REPLACE FUNCTION benchmark.profile_longitude(value bigint, spread_km double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT 37.62 +
    cos((((value * 214013 + 2531011) % 2147483647)::double precision / 2147483647) * pi() * 2) *
    sqrt(((value * 1103515245 + 12345) % 2147483647)::double precision / 2147483647) * spread_km /
    (111.32 * cos(radians(55.75)))
$$;

CREATE OR REPLACE FUNCTION benchmark.profile_latitude(value bigint, spread_km double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT 55.75 +
    sin((((value * 214013 + 2531011) % 2147483647)::double precision / 2147483647) * pi() * 2) *
    sqrt(((value * 1103515245 + 12345) % 2147483647)::double precision / 2147483647) * spread_km / 111.32
$$;

CREATE OR REPLACE PROCEDURE benchmark.seed_spread_profile(
  suffix text,
  spread_km double precision,
  point_count integer DEFAULT 250000,
  line_count integer DEFAULT 50000,
  polygon_count integer DEFAULT 10000,
  vertices_per_feature integer DEFAULT 16
)
LANGUAGE plpgsql
AS $$
DECLARE
  points_table text := 'points_' || suffix;
  lines_table text := 'lines_' || suffix;
  polygons_table text := 'polygons_' || suffix;
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS benchmark.%I (LIKE benchmark.points INCLUDING ALL)', points_table);
  EXECUTE format('CREATE TABLE IF NOT EXISTS benchmark.%I (LIKE benchmark.lines INCLUDING ALL)', lines_table);
  EXECUTE format('CREATE TABLE IF NOT EXISTS benchmark.%I (LIKE benchmark.polygons INCLUDING ALL)', polygons_table);
  EXECUTE format('TRUNCATE benchmark.%I, benchmark.%I, benchmark.%I', points_table, lines_table, polygons_table);

  EXECUTE format($sql$
    INSERT INTO benchmark.%I (id, category, weight, label, geom)
    SELECT id, id %% 8, ((id * 48271) %% 2147483647)::real / 2147483647,
      'Объект ' || id,
      ST_SetSRID(ST_MakePoint(benchmark.profile_longitude(id, $2), benchmark.profile_latitude(id, $2)), 4326)
    FROM generate_series(1, $1::bigint) AS id
  $sql$, points_table) USING point_count, spread_km;

  EXECUTE format($sql$
    INSERT INTO benchmark.%I (id, category, weight, label, geom)
    SELECT id, id %% 8, ((id * 48271) %% 2147483647)::real / 2147483647,
      'Линия ' || id,
      ST_SetSRID(ST_MakeLine(ARRAY(
        SELECT ST_MakePoint(
          benchmark.profile_longitude(id, $3) + (vertex::double precision / GREATEST($2 - 1, 1) - 0.5) * 0.025,
          benchmark.profile_latitude(id, $3) + sin(vertex::double precision / GREATEST($2 - 1, 1) * pi() * 2 + id) * 0.004
        ) FROM generate_series(0, GREATEST($2, 2) - 1) AS vertex
      )), 4326)
    FROM generate_series(1, $1::bigint) AS id
  $sql$, lines_table) USING line_count, vertices_per_feature, spread_km;

  EXECUTE format($sql$
    INSERT INTO benchmark.%I (id, category, weight, label, geom)
    SELECT id, id %% 8, ((id * 48271) %% 2147483647)::real / 2147483647,
      'Полигон ' || id,
      ST_SetSRID(ST_Buffer(
        ST_MakePoint(benchmark.profile_longitude(id, $2), benchmark.profile_latitude(id, $2)),
        0.001 + ((id * 16807) %% 1000)::double precision / 1000 * 0.003,
        'quad_segs=' || GREATEST(1, $3 / 4)
      ), 4326)
    FROM generate_series(1, $1::bigint) AS id
  $sql$, polygons_table) USING polygon_count, spread_km, vertices_per_feature;

  EXECUTE format('ANALYZE benchmark.%I', points_table);
  EXECUTE format('ANALYZE benchmark.%I', lines_table);
  EXECUTE format('ANALYZE benchmark.%I', polygons_table);
END;
$$;

CALL benchmark.seed_spread_profile('r3', 3);
CALL benchmark.seed_spread_profile('r30', 30);
CALL benchmark.seed_spread_profile('r150', 150);
