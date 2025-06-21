const express = require('express');
const cors = require('cors');

const app = express();

// Enable CORS for all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      console.log(logLine);
    }
  });

  next();
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ message: "Air Quality API Server", status: "running" });
});

// Helper functions
function calculateAQI(pm25) {
  if (pm25 <= 12) return Math.round((50 / 12) * pm25);
  if (pm25 <= 35.4) return Math.round(((100 - 51) / (35.4 - 12.1)) * (pm25 - 12.1) + 51);
  if (pm25 <= 55.4) return Math.round(((150 - 101) / (55.4 - 35.5)) * (pm25 - 35.5) + 101);
  if (pm25 <= 150.4) return Math.round(((200 - 151) / (150.4 - 55.5)) * (pm25 - 55.5) + 151);
  if (pm25 <= 250.4) return Math.round(((300 - 201) / (250.4 - 150.5)) * (pm25 - 150.5) + 201);
  return Math.round(((500 - 301) / (500.4 - 250.5)) * (pm25 - 250.5) + 301);
}

function getAQIStatus(aqi) {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

// ThingSpeak channels for Malaysian air quality sensors
const sensorChannels = {
  'bandar_ipoh': {
    aqiUrl: 'https://api.thingspeak.com/channels/1656794/feeds.json?api_key=18T27314PL23U160&results=1',
    rawUrl: 'https://api.thingspeak.com/channels/2765275/feeds.json?results=1',
    name: 'Bandar Ipoh',
    lat: 4.607211,
    lon: 101.090918,
  },
  'perindustrian_tasek': {
    aqiUrl: 'https://api.thingspeak.com/channels/1656796/feeds.json?api_key=0Q18INS0V5WK69JV&results=1',
    rawUrl: 'https://api.thingspeak.com/channels/2765301/feeds.json?results=1',
    name: 'Perindustrian Tasek',
    lat: 4.639697,
    lon: 101.102087,
  },
};

function findNearestSensor(lat, lon) {
  let minDistance = Infinity;
  let nearestSensor = 'bandar_ipoh';

  for (const [sensorKey, sensor] of Object.entries(sensorChannels)) {
    const distance = Math.abs(lat - sensor.lat) + Math.abs(lon - sensor.lon);
    
    if (distance < minDistance) {
      minDistance = distance;
      nearestSensor = sensorKey;
    }
  }
  
  return nearestSensor;
}

// Air Quality API endpoint
app.get("/api/air-quality", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 4.607211;
    const lon = parseFloat(req.query.lon) || 101.090918;
    
    const sensorKey = findNearestSensor(lat, lon);
    const sensor = sensorChannels[sensorKey];
    
    // Fetch AQI and raw data from ThingSpeak
    const [aqiResponse, rawResponse] = await Promise.all([
      fetch(sensor.aqiUrl),
      fetch(sensor.rawUrl)
    ]);
    
    if (!aqiResponse.ok) {
      throw new Error(`ThingSpeak AQI API error: ${aqiResponse.status}`);
    }
    
    const aqiData = await aqiResponse.json();
    const rawData = rawResponse.ok ? await rawResponse.json() : null;
    
    const feed = aqiData.feeds[0];
    const rawFeed = rawData?.feeds?.[0];
    
    // Parse AQI values (these are already calculated AQI index values)
    const o3 = feed.field1 ? parseFloat(feed.field1) : null;
    const co = feed.field2 ? parseFloat(feed.field2) : null;
    const so2 = feed.field3 ? parseFloat(feed.field3) : null;
    const no2 = feed.field4 ? parseFloat(feed.field4) : null;
    const pm25 = feed.field5 ? parseFloat(feed.field5) : null;
    const aqi = feed.field6 ? parseFloat(feed.field6) : 0;
    
    // Parse raw pollutant concentrations (ppb and μg/m³)
    const rawNO2 = rawFeed?.field1 ? parseFloat(rawFeed.field1) : null;
    const rawO3 = rawFeed?.field2 ? parseFloat(rawFeed.field2) : null;
    const rawCO = rawFeed?.field3 ? parseFloat(rawFeed.field3) : null;
    const rawSO2 = rawFeed?.field4 ? parseFloat(rawFeed.field4) : null;
    const rawPM25 = rawFeed?.field7 ? parseFloat(rawFeed.field7) : null;
    const rawPM10 = rawFeed?.field8 ? parseFloat(rawFeed.field8) : null;
    
    res.json({
      aqi,
      pm25,
      pm10: null,
      no2,
      o3,
      so2,
      co,
      rawNO2,
      rawO3,
      rawCO,
      rawSO2,
      rawPM25,
      rawPM10,
      status: getAQIStatus(aqi),
      location: sensor.name,
      latitude: sensor.lat,
      longitude: sensor.lon,
    });
  } catch (error) {
    console.error('Air quality API error:', error);
    res.status(500).json({ error: 'Failed to fetch air quality data' });
  }
});

// Weather API endpoint
app.get("/api/weather", async (req, res) => {
  try {
    // Return realistic weather data for Malaysia
    res.json({
      temperature: 26,
      humidity: 78,
      pressure: 1010,
      windSpeed: 2.5,
      windDirection: 180,
      uvIndex: 5.2,
      description: 'Partly cloudy',
    });
  } catch (error) {
    console.error('Weather API error:', error);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});

// Forecast API endpoint
app.get("/api/air-quality/forecast", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 4.607211;
    const lon = parseFloat(req.query.lon) || 101.090918;
    
    // Get current air quality data
    const sensorKey = findNearestSensor(lat, lon);
    const sensor = sensorChannels[sensorKey];
    
    const aqiResponse = await fetch(sensor.aqiUrl);
    const aqiData = await aqiResponse.json();
    const currentAqi = aqiData.feeds[0].field6 ? parseFloat(aqiData.feeds[0].field6) : 50;
    
    const currentHour = new Date().getHours();
    const forecast = [];
    
    for (let i = 0; i < 8; i++) {
      const hour = (currentHour + i) % 24;
      const variation = (i * 2) - 5;
      const forecastAqi = Math.max(0, Math.min(500, currentAqi + variation));
      
      forecast.push({
        hour,
        aqi: forecastAqi,
        status: getAQIStatus(forecastAqi),
      });
    }
    
    res.json(forecast);
  } catch (error) {
    console.error('Forecast API error:', error);
    res.status(500).json({ error: 'Failed to generate forecast' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Air Quality API Server running on port ${port}`);
});