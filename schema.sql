DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS weathers;

CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  search_query VARCHAR(100),
  formatted_query VARCHAR(100),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7)
);

CREATE TABLE weathers (
  id SERIAL PRIMARY KEY,
  forecast VARCHAR(500),
  time VARCHAR(100),
  location_id INTEGER NOT NULL,
  FOREIGN KEY (location_id) REFERENCES locations (id)
);
