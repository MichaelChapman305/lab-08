'use strict';

//--------------------------------
// Load Enviroment Variables from the .env file
//--------------------------------
require('dotenv').config();

//--------------------------------g
//--------------------------------
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');

//--------------------------------
//Application setup
//--------------------------------
const PORT = process.env.PORT;
const app = express();
app.use(cors());

//--------------------------------
// Database Config
//--------------------------------
const client = new pg.Client(process.env.DATABASE_URL);

client.connect();

client.on('err', err => console.error(err));

//--------------------------------
// Lookup Functions
//--------------------------------

let lookup = (handler) => {
  let SQL = `SELECT * FROM ${handler.tableName} WHERE location_id=$1;`;

  return client.query(SQL, [handler.location_id])
    .then(results => {
      if (results.rowCount > 0) {
        handler.cacheHit(results);
      } else {
        handler.cacheMiss();
      }
    })
    .catch(() => errorMessage());
};

//--------------------------------
// Constructors Functions
//--------------------------------
function Location(query, geoData) {
  this.search_query = query;
  this.formatted_query = geoData.formatted_address;
  this.latitude = geoData.geometry.location.lat;
  this.longitude = geoData.geometry.location.lng;
}

function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toDateString();
}

Weather.tableName = 'weathers';
Weather.lookup = lookup;

function Events(data) {
  let time = Date.parse(data.start.local);
  let newDate = new Date(time).toDateString();
  this.link = data.url;
  this.name = data.name.text;
  this.event_date = newDate;
  this.summary = data.summary;
}

Events.tableName = 'events';
Events.lookup = lookup;

//--------------------------------
// Database and API Query for Locations
//--------------------------------
Location.lookup = handler => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1;`;
  const values = [handler.query];

  return client.query(SQL, values)
    .then(results => {
      if (results.rowCount > 0) {
        handler.cacheHit(results);
      } else {
        handler.cacheMiss(results);
      }
    })
    .catch(console.error);
};

Location.fetchLocation = (data) => {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${data}&key=${process.env.GEOCODE_API_KEY}`;

  return superagent.get(url)
    .then(result => {
      if (!result.body.results.length) throw 'no data';
      let location = new Location(data, result.body.results[0]);
      return location.save()
        .then(result => {
          location.id = result.rows[0].id;
          return location;
        });

    })
    .catch(() => errorMessage());
};

Location.prototype.save = function() {
  let SQL = `INSERT INTO locations 
    (search_query, formatted_query, latitude, longitude)
    VALUES ($1, $2, $3, $4)
    RETURNING id;`;

  let values = Object.values(this);
  return client.query(SQL, values);
};

//--------------------------------
// Database and API Query for Weather
//--------------------------------
Weather.fetch = (query) => {
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${query.latitude},${query.longitude}`;

  return superagent.get(url)
    .then(result => {
      let weatherData = result.body.daily.data.map(day => {
        let weather = new Weather(day);
        weather.save(query.id);
        return weather;
      });
      return weatherData;
    })
    .catch(() => errorMessage());
};

Weather.prototype.save = function(location_id) {
  let SQL = `INSERT INTO weathers 
    (forecast, time, location_id)
    VALUES ($1, $2, $3);`;

  let values = Object.values(this);
  values.push(location_id);

  return client.query(SQL, values);
};

//--------------------------------
// Database and API Query for Event
//--------------------------------
Events.fetch = (query) => {
  let url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${query.formatted_query}`;

  return superagent.get(url)
    .then(result => {
      const eventData = result.body.events.map(item => {
        let event = new Events(item);
        event.save(query.id);
        return event;
      });

      return eventData;
    })
    .catch(() => errorMessage());
};

Events.prototype.save = function(location_id) {
  let SQL = `INSERT INTO events 
    (link, name, event_date, summary, location_id)
    VALUES ($1, $2, $3, $4, $5);`;

  let values = Object.values(this);
  values.push(location_id);

  return client.query(SQL, values);
};

//--------------------------------
// Route Callbacks
//--------------------------------
let getLocation = (request, response) => {
  const locationHandler = {
    query: request.query.data,
    cacheHit: result => {
      response.send(result.rows[0]);
    },
    cacheMiss: () => {
      Location.fetchLocation(request.query.data)
        .then(result => response.send(result));
    }
  };

  Location.lookup(locationHandler);
};

let getWeather = (request, response) => {
  const weatherHandler = {
    location_id: request.query.data.id,
    tableName: Weather.tableName,
    cacheHit: (result) => {
      response.send(result.rows);
    },
    cacheMiss: () => {
      Weather.fetch(request.query.data)
        .then((results) => response.send(results))
        .catch(() => errorMessage());
    }
  };

  Weather.lookup(weatherHandler);
};

let getEvents = (request, response) => {
  const eventHandler = {
    location_id: request.query.data.id,
    tableName: Events.tableName,
    cacheHit: (result) => {
      response.send(result.rows);
    },
    cacheMiss: () => {
      Events.fetch(request.query.data)
        .then((results) => response.send(results))
        .catch(() => errorMessage());
    }
  };

  Events.lookup(eventHandler);
};

//--------------------------------
// Routes
//--------------------------------
app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('/events', getEvents);

//--------------------------------
// Error Message
//--------------------------------
let errorMessage = () => {
  let errorObj = {
    status: 500,
    responseText: 'Sorry something went wrong',
  };
  return errorObj;
};

//--------------------------------
// Power On
//--------------------------------
app.listen(PORT, () => console.log(`app is listening ${PORT}`));
