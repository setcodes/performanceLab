CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS benchmark;

CREATE TABLE IF NOT EXISTS benchmark.points (
  id bigint PRIMARY KEY,
  category smallint NOT NULL,
  weight real NOT NULL,
  label text NOT NULL,
  geom geometry(Point, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark.lines (
  id bigint PRIMARY KEY,
  category smallint NOT NULL,
  weight real NOT NULL,
  label text NOT NULL,
  geom geometry(LineString, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark.polygons (
  id bigint PRIMARY KEY,
  category smallint NOT NULL,
  weight real NOT NULL,
  label text NOT NULL,
  geom geometry(Polygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS points_geom_gix ON benchmark.points USING gist (geom);
CREATE INDEX IF NOT EXISTS lines_geom_gix ON benchmark.lines USING gist (geom);
CREATE INDEX IF NOT EXISTS polygons_geom_gix ON benchmark.polygons USING gist (geom);

CREATE OR REPLACE FUNCTION benchmark.longitude_for(value bigint)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT 37.2 + (((value * 1103515245 + 12345) % 2147483647)::double precision / 2147483647) * 0.8
$$;

CREATE OR REPLACE FUNCTION benchmark.latitude_for(value bigint)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT 55.5 + (((value * 214013 + 2531011) % 2147483647)::double precision / 2147483647) * 0.5
$$;

CREATE OR REPLACE PROCEDURE benchmark.seed(
  point_count integer DEFAULT 250000,
  line_count integer DEFAULT 50000,
  polygon_count integer DEFAULT 10000,
  vertices_per_feature integer DEFAULT 16
)
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE benchmark.points, benchmark.lines, benchmark.polygons;

  INSERT INTO benchmark.points (id, category, weight, label, geom)
  SELECT
    id,
    id % 8,
    ((id * 48271) % 2147483647)::real / 2147483647,
    'Объект ' || id,
    ST_SetSRID(ST_MakePoint(benchmark.longitude_for(id), benchmark.latitude_for(id)), 4326)
  FROM generate_series(1, point_count::bigint) AS id;

  INSERT INTO benchmark.lines (id, category, weight, label, geom)
  SELECT
    id,
    id % 8,
    ((id * 48271) % 2147483647)::real / 2147483647,
    'Линия ' || id,
    ST_SetSRID(ST_MakeLine(ARRAY(
      SELECT ST_MakePoint(
        benchmark.longitude_for(id) + (vertex::double precision / GREATEST(vertices_per_feature - 1, 1) - 0.5) * 0.025,
        benchmark.latitude_for(id) + sin(vertex::double precision / GREATEST(vertices_per_feature - 1, 1) * pi() * 2 + id) * 0.004
      )
      FROM generate_series(0, GREATEST(vertices_per_feature, 2) - 1) AS vertex
    )), 4326)
  FROM generate_series(1, line_count::bigint) AS id;

  INSERT INTO benchmark.polygons (id, category, weight, label, geom)
  SELECT
    id,
    id % 8,
    ((id * 48271) % 2147483647)::real / 2147483647,
    'Полигон ' || id,
    ST_SetSRID(ST_Buffer(
      ST_MakePoint(benchmark.longitude_for(id), benchmark.latitude_for(id)),
      0.001 + ((id * 16807) % 1000)::double precision / 1000 * 0.003,
      'quad_segs=' || GREATEST(1, vertices_per_feature / 4)
    ), 4326)
  FROM generate_series(1, polygon_count::bigint) AS id;

  ANALYZE benchmark.points;
  ANALYZE benchmark.lines;
  ANALYZE benchmark.polygons;
END;
$$;

COMMENT ON TABLE benchmark.points IS '{"name":"Benchmark points","description":"Deterministic point dataset for MapLibre performance tests","minzoom":0,"maxzoom":18}';
COMMENT ON TABLE benchmark.lines IS '{"name":"Benchmark lines","description":"Deterministic line dataset for MapLibre performance tests","minzoom":0,"maxzoom":18}';
COMMENT ON TABLE benchmark.polygons IS '{"name":"Benchmark polygons","description":"Deterministic polygon dataset for MapLibre performance tests","minzoom":0,"maxzoom":18}';

CALL benchmark.seed(250000, 50000, 10000, 16);

