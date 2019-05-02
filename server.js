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

function Events(data) {
  let time = Date.parse(data.start.local);
  let newDate = new Date(time).toDateString();
  this.link = data.url;
  this.name = data.name.text;
  this.event_date = newDate;
  this.summary = data.summary;
}

//--------------------------------
// Database Query
//--------------------------------
Location.lookup = handler => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1`;
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

let weatherFromDB = (location_id) => {
  // const SQL = `SELECT * FROM weathers WHERE location_id=$1`;
  // const values = [location_id];
  // client.query(SQL, values);

  //check if specific weather in DB
  //If yes, send that record back to client
  //If no, call weatherFromAPI

};

let weatherFromAPI = (query) => {
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${query.latitude},${query.longitude}`;

  return superagent.get(url)
    .then(result => {
      return result.body.daily.data.map(day => {
        let weather = new Weather(day);
        return weather.save();
      }).then(result => {
        console.log('weather API result');
        console.log(result);
        // weather.id = result.rows[0].id;
        // return weather;
      })
        .catch(() => errorMessage());
    })
    .catch(() => errorMessage());
};

Weather.prototype.save = function(location_id) {
  console.log('SAVE');

  let SQL = `INSERT INTO weathers 
    (forecast, time, location_id)
    VALUES ($1, $2, $3)
    RETURNING id;`;

  let values = Object.values(this);
  values.push(location_id);

  return client.query(SQL, values);
};

let lookupAll = (handler) => {
  let SQL = `SELECT * FROM ${handler.tableName}`;

  client.query(SQL)
    .then(results => {
      if (results.rowCount > 0) {
        handler.catchHit(results);
      } else {
        handler.catchMiss(results);
      }
    });
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
  // build weather handler
  const weatherHandler = {
    location_id: request.query.data.id,
    tableName: 'weathers',
    cacheHit: () => console.log('Weather cacheHit'),
    cacheMiss: () => weatherFromAPI(request.query.data.id)
  };

  lookupAll(weatherHandler);
};

// let searchWeather = (request, response) => {
//   const data = request.query.data;
//   const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${data.latitude},${data.longitude}`;

//   return superagent.get(url)
//     .then(result => {
//       const dailyWeather = result.body.daily.data.map(day => {
//         return new Weather(day);
//       });

//       response.send(dailyWeather);
//     })
//     .catch(() => errorMessage());
// };

let searchEvents = (request, response) => {
  let url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${request.query.data.formatted_query}`;

  return superagent.get(url)
    .then(result => {
      const eventData = result.body.events.map(event => {
        return new Events(event);
      });

      response.send(eventData);
    })
    .catch(() => errorMessage());
};

//--------------------------------
// Routes
//--------------------------------
app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('/events', searchEvents);

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
