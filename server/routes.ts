import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertAirQualityDataSchema } from "@shared/schema";

// Weather impact coefficients for predictive modeling
const WEATHER_IMPACT_COEFFICIENTS = {
  windSpeed: { low: 1.3, medium: 1.0, high: 0.7 },
  humidity: { low: 0.9, medium: 1.0, high: 1.2 },
  pressure: { low: 1.2, medium: 1.0, high: 0.9 },
  temperature: { cold: 0.9, mild: 1.0, hot: 1.15 }
};

function calculateWeatherImpact(weather: any) {
  let windEffect = WEATHER_IMPACT_COEFFICIENTS.windSpeed.medium;
  if (weather.windSpeed < 5) windEffect = WEATHER_IMPACT_COEFFICIENTS.windSpeed.low;
  else if (weather.windSpeed > 15) windEffect = WEATHER_IMPACT_COEFFICIENTS.windSpeed.high;

  let humidityEffect = WEATHER_IMPACT_COEFFICIENTS.humidity.medium;
  if (weather.humidity < 40) humidityEffect = WEATHER_IMPACT_COEFFICIENTS.humidity.low;
  else if (weather.humidity > 70) humidityEffect = WEATHER_IMPACT_COEFFICIENTS.humidity.high;

  let pressureEffect = WEATHER_IMPACT_COEFFICIENTS.pressure.medium;
  if (weather.pressure < 1013) pressureEffect = WEATHER_IMPACT_COEFFICIENTS.pressure.low;
  else if (weather.pressure > 1023) pressureEffect = WEATHER_IMPACT_COEFFICIENTS.pressure.high;

  let temperatureEffect = WEATHER_IMPACT_COEFFICIENTS.temperature.mild;
  if (weather.temperature < 15) temperatureEffect = WEATHER_IMPACT_COEFFICIENTS.temperature.cold;
  else if (weather.temperature > 25) temperatureEffect = WEATHER_IMPACT_COEFFICIENTS.temperature.hot;

  const totalMultiplier = (windEffect + humidityEffect + pressureEffect + temperatureEffect) / 4;
  return { windEffect, humidityEffect, pressureEffect, temperatureEffect, totalMultiplier };
}

function analyzeAQITrend(historical: any[]) {
  if (historical.length < 2) {
    return { trend: 'stable', volatility: 0, averageAQI: historical[0]?.aqi || 50 };
  }

  const recent = historical.slice(-6);
  const aqiValues = recent.map((d: any) => d.aqi);
  const averageAQI = aqiValues.reduce((a: number, b: number) => a + b, 0) / aqiValues.length;

  const n = aqiValues.length;
  const xSum = (n * (n - 1)) / 2;
  const ySum = aqiValues.reduce((a: number, b: number) => a + b, 0);
  const xySum = aqiValues.reduce((sum: number, y: number, i: number) => sum + i * y, 0);
  const xxSum = (n * (n - 1) * (2 * n - 1)) / 6;

  const slope = (n * xySum - xSum * ySum) / (n * xxSum - xSum * xSum);
  const variance = aqiValues.reduce((sum: number, aqi: number) => sum + Math.pow(aqi - averageAQI, 2), 0) / n;
  const volatility = Math.sqrt(variance);

  let trend: 'improving' | 'stable' | 'deteriorating' = 'stable';
  if (slope < -0.5) trend = 'improving';
  else if (slope > 0.5) trend = 'deteriorating';

  return { trend, volatility, averageAQI };
}

function generatePredictiveForecast(currentAQI: any[], weatherForecast: any[], regionalData?: any[]) {
  if (!currentAQI.length || !weatherForecast.length) return [];

  const primaryTrend = analyzeAQITrend(currentAQI);
  const regionalTrend = regionalData ? analyzeAQITrend(regionalData) : null;

  return weatherForecast.map((weather, index) => {
    const weatherImpact = calculateWeatherImpact(weather);
    
    let baseAQI = primaryTrend.averageAQI;
    if (regionalTrend) {
      const regionalWeight = 0.3;
      baseAQI = baseAQI * (1 - regionalWeight) + regionalTrend.averageAQI * regionalWeight;
    }

    const trendModifier = primaryTrend.trend === 'improving' ? 0.95 : 
                         primaryTrend.trend === 'deteriorating' ? 1.05 : 1.0;
    
    const timeMultiplier = Math.pow(trendModifier, index + 1);
    const predictedAQI = Math.max(0, Math.round(baseAQI * timeMultiplier * weatherImpact.totalMultiplier));
    
    const confidence = Math.max(0.3, Math.min(0.95, 1 - (primaryTrend.volatility / 100) - (index * 0.05)));

    let prediction: 'improving' | 'stable' | 'deteriorating' = 'stable';
    if (weatherImpact.totalMultiplier < 0.95) prediction = 'improving';
    else if (weatherImpact.totalMultiplier > 1.05) prediction = 'deteriorating';

    return {
      hour: weather.hour,
      aqi: predictedAQI,
      status: getAQIStatus(predictedAQI),
      confidence: Math.round(confidence * 100) / 100,
      weatherFactors: {
        windEffect: weatherImpact.windEffect,
        humidityEffect: weatherImpact.humidityEffect,
        pressureEffect: weatherImpact.pressureEffect,
        temperatureEffect: weatherImpact.temperatureEffect
      },
      prediction
    };
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Air Quality API endpoints
  app.get("/api/air-quality", async (req, res) => {
    try {
      const { lat, lon, apiUrl } = req.query;
      
      if (!lat || !lon) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }

      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lon as string);

      // Define sensor locations with their ThingSpeak channels for AQI and raw data
      const sensorLocations = [
        {
          name: "Bandar Ipoh",
          latitude: 4.607211,
          longitude: 101.090918,
          apiUrl: "https://api.thingspeak.com/channels/1656794/feeds.json?api_key=18T27314PL23U160&results=1",
          rawDataUrl: "https://api.thingspeak.com/channels/2765275/feeds.json?api_key=RT85EGJQSJQKJ0ZL&results=1"
        },
        {
          name: "Perindustrian Tasek", 
          latitude: 4.639697,
          longitude: 101.102087,
          apiUrl: "https://api.thingspeak.com/channels/1656796/feeds.json?api_key=0Q18INS0V5WK69JV&results=1",
          rawDataUrl: "https://api.thingspeak.com/channels/2765301/feeds.json?api_key=2XWVN6TDCAV3VKFD&results=1"
        }
      ];

      // Find the closest sensor or use the specific API URL if provided
      let selectedSensor = sensorLocations[0]; // Default to first sensor
      
      if (apiUrl) {
        selectedSensor = sensorLocations.find(sensor => sensor.apiUrl === apiUrl) || selectedSensor;
      } else {
        // Find closest sensor based on coordinates
        selectedSensor = sensorLocations.reduce((closest, current) => {
          const closestDistance = calculateDistance(latitude, longitude, closest.latitude, closest.longitude);
          const currentDistance = calculateDistance(latitude, longitude, current.latitude, current.longitude);
          return currentDistance < closestDistance ? current : closest;
        });
      }

      let thingSpeakUrl = selectedSensor.apiUrl;

      // Get from ThingSpeak API
      const response = await fetch(thingSpeakUrl);
      
      // Fetch raw pollutant data from the second API
      const rawResponse = await fetch(selectedSensor.rawDataUrl);

      if (!response.ok) {
        throw new Error(`ThingSpeak API error: ${response.statusText}`);
      }

      if (!rawResponse.ok) {
        console.warn(`Raw data API error: ${rawResponse.statusText}`);
      }

      const data = await response.json();
      const rawData = rawResponse.ok ? await rawResponse.json() : null;
      
      const feed = data.feeds[0];
      const channel = data.channel;
      const rawFeed = rawData && rawData.feeds && rawData.feeds.length > 0 ? rawData.feeds[0] : null;
      
      if (!feed) {
        throw new Error("No data available from ThingSpeak");
      }

      // Get location data from ThingSpeak channel
      const channelLatitude = parseFloat(channel?.latitude) || latitude;
      const channelLongitude = parseFloat(channel?.longitude) || longitude;
      const elevation = parseFloat(channel?.elevation) || null;

      // Map ThingSpeak fields to air quality data (AQI values)
      const o3 = feed.field1 ? parseFloat(feed.field1) : null;
      const co = feed.field2 ? parseFloat(feed.field2) : null;
      const so2 = feed.field3 ? parseFloat(feed.field3) : null;
      const no2 = feed.field4 ? parseFloat(feed.field4) : null;
      const pm25 = feed.field5 ? parseFloat(feed.field5) : null;
      const aqi = feed.field6 ? parseFloat(feed.field6) : null;
      const pm10 = null;

      // Map raw pollutant data (μg/m³ values) - correct field mapping
      const rawPollutants: any = {};
      if (rawFeed) {
        // Field1 = NO2, Field2 = O3, Field3 = CO, Field4 = SO2, Field7 = PM2.5, Field8 = PM10
        rawPollutants.rawNO2 = rawFeed.field1 ? parseFloat(rawFeed.field1) : null;
        rawPollutants.rawO3 = rawFeed.field2 ? parseFloat(rawFeed.field2) : null;
        rawPollutants.rawCO = rawFeed.field3 ? parseFloat(rawFeed.field3) : null;
        rawPollutants.rawSO2 = rawFeed.field4 ? parseFloat(rawFeed.field4) : null;
        rawPollutants.rawPM25 = rawFeed.field7 ? parseFloat(rawFeed.field7) : null;
        rawPollutants.rawPM10 = rawFeed.field8 ? parseFloat(rawFeed.field8) : null;
      }
      
      const airQualityData = {
        aqi,
        pm25,
        pm10,
        no2,
        o3,
        so2,
        co,
        ...rawPollutants,
        status: aqi ? getAQIStatus(aqi) : 'No data',
        location: elevation ? `${elevation}m elevation` : `${channelLatitude.toFixed(4)}, ${channelLongitude.toFixed(4)}`,
        latitude: channelLatitude,
        longitude: channelLongitude,
        elevation
      };

      // Store in memory using ThingSpeak coordinates
      await storage.createAirQualityData({
        latitude: channelLatitude,
        longitude: channelLongitude,
        aqi: airQualityData.aqi,
        pm25: airQualityData.pm25,
        pm10: airQualityData.pm10,
        no2: airQualityData.no2,
        o3: airQualityData.o3,
        so2: airQualityData.so2,
        co: airQualityData.co
      });

      res.json(airQualityData);
    } catch (error) {
      console.error("Air quality API error:", error);
      res.status(500).json({ error: "Failed to fetch air quality data" });
    }
  });

  // Enhanced predictive forecast endpoint
  app.get("/api/air-quality/forecast", async (req, res) => {
    try {
      const { lat, lon, apiUrl } = req.query;
      
      if (!lat || !lon) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }

      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lon as string);

      // Determine which APIs to use
      let primaryApiUrl = "https://api.thingspeak.com/channels/1656794/feeds.json?api_key=18T27314PL23U160&results=24";
      let secondaryApiUrl = "https://api.thingspeak.com/channels/1656796/feeds.json?api_key=0Q18INS0V5WK69JV&results=24";
      
      if (apiUrl) {
        primaryApiUrl = (apiUrl as string).replace('results=1', 'results=24');
      } else if (latitude > 37.78) {
        // Swap APIs for northern coordinates
        [primaryApiUrl, secondaryApiUrl] = [secondaryApiUrl, primaryApiUrl];
      }

      // Fetch historical data from both sensors
      const [primaryResponse, secondaryResponse, weatherForecastResponse] = await Promise.all([
        fetch(primaryApiUrl),
        fetch(secondaryApiUrl),
        fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${latitude}&lon=${longitude}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`)
      ]);

      if (!primaryResponse.ok) {
        throw new Error(`Primary sensor API error: ${primaryResponse.statusText}`);
      }

      const primaryData = await primaryResponse.json();
      const primaryFeeds = primaryData.feeds || [];

      // Process secondary sensor data (optional)
      let secondaryFeeds: any[] = [];
      if (secondaryResponse.ok) {
        const secondaryData = await secondaryResponse.json();
        secondaryFeeds = secondaryData.feeds || [];
      }

      // Process weather forecast data
      let weatherForecast: any[] = [];
      if (weatherForecastResponse.ok) {
        const weatherData = await weatherForecastResponse.json();
        weatherForecast = (weatherData.list || []).slice(0, 8).map((item: any) => ({
          hour: new Date(item.dt * 1000).getHours(),
          temperature: Math.round(item.main.temp),
          humidity: item.main.humidity,
          windSpeed: Math.round((item.wind?.speed || 0) * 3.6),
          windDirection: item.wind?.deg || 0,
          pressure: item.main.pressure,
          description: item.weather[0]?.description || "clear",
          icon: item.weather[0]?.icon || "01d"
        }));
      }

      // Convert historical data to AirQualityData format
      const primaryAQIHistory = primaryFeeds.map((feed: any) => ({
        aqi: parseFloat(feed.field6) || 0,
        pm25: parseFloat(feed.field5) || 0,
        no2: parseFloat(feed.field4) || 0,
        o3: parseFloat(feed.field1) || 0,
        co: parseFloat(feed.field2) || 0,
        so2: parseFloat(feed.field3) || 0,
        status: getAQIStatus(parseFloat(feed.field6) || 0),
        location: primaryData.channel?.name || "Sensor Location",
        timestamp: new Date(feed.created_at)
      }));

      const secondaryAQIHistory = secondaryFeeds.map((feed: any) => ({
        aqi: parseFloat(feed.field6) || 0,
        pm25: parseFloat(feed.field5) || 0,
        no2: parseFloat(feed.field4) || 0,
        o3: parseFloat(feed.field1) || 0,
        co: parseFloat(feed.field2) || 0,
        so2: parseFloat(feed.field3) || 0,
        status: getAQIStatus(parseFloat(feed.field6) || 0),
        location: "Secondary Sensor",
        timestamp: new Date(feed.created_at)
      }));

      // Generate predictive forecast
      const forecast = generatePredictiveForecast(
        primaryAQIHistory,
        weatherForecast,
        secondaryAQIHistory.length > 0 ? secondaryAQIHistory : undefined
      );

      // If no forecast generated, create basic forecast
      if (forecast.length === 0) {
        const latestAQI = primaryAQIHistory[0]?.aqi || 50;
        const basicForecast = Array.from({ length: 8 }, (_, i) => ({
          hour: new Date(Date.now() + i * 60 * 60 * 1000).getHours(),
          aqi: Math.max(0, Math.round(latestAQI + (Math.random() - 0.5) * 10)),
          status: getAQIStatus(latestAQI),
          confidence: 0.6,
          weatherFactors: {
            windEffect: 1.0,
            humidityEffect: 1.0,
            pressureEffect: 1.0,
            temperatureEffect: 1.0
          },
          prediction: 'stable' as const
        }));
        return res.json(basicForecast);
      }

      res.json(forecast);
    } catch (error) {
      console.error("Enhanced forecast API error:", error);
      res.status(500).json({ error: "Failed to generate predictive forecast" });
    }
  });

  // Weather API endpoint
  app.get("/api/weather", async (req, res) => {
    try {
      const { lat, lon } = req.query;
      
      if (!lat || !lon) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }

      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lon as string);

      // Get weather data from OpenWeatherMap
      const weatherResponse = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`
      );

      if (!weatherResponse.ok) {
        throw new Error(`OpenWeatherMap API error: ${weatherResponse.statusText}`);
      }

      const weatherData = await weatherResponse.json();

      // Get UV Index data
      const uvResponse = await fetch(
        `https://api.openweathermap.org/data/2.5/uvi?lat=${latitude}&lon=${longitude}&appid=${process.env.OPENWEATHER_API_KEY}`
      );

      let uvIndex = 0;
      if (uvResponse.ok) {
        const uvData = await uvResponse.json();
        uvIndex = uvData.value || 0;
      }

      const weather = {
        temperature: Math.round(weatherData.main.temp),
        humidity: weatherData.main.humidity,
        pressure: weatherData.main.pressure,
        windSpeed: Math.round((weatherData.wind?.speed || 0) * 3.6), // Convert m/s to km/h
        windDirection: weatherData.wind?.deg || 0,
        visibility: Math.round((weatherData.visibility || 10000) / 1000), // Convert to km
        uvIndex: Math.round(uvIndex),
        description: weatherData.weather[0]?.description || "Clear",
        icon: weatherData.weather[0]?.icon || "01d",
        location: weatherData.name || "Unknown",
        timestamp: new Date()
      };

      res.json(weather);
    } catch (error) {
      console.error("Weather API error:", error);
      res.status(500).json({ error: "Failed to fetch weather data" });
    }
  });

  // News articles endpoint
  app.get("/api/news", async (req, res) => {
    try {
      const articles = await storage.getAllNewsArticles();
      res.json(articles);
    } catch (error) {
      console.error("News API error:", error);
      res.status(500).json({ error: "Failed to fetch news articles" });
    }
  });

  // Nearby stations endpoint
  app.get("/api/stations", async (req, res) => {
    try {
      const { lat, lon } = req.query;
      
      if (!lat || !lon) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }

      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lon as string);
      
      const stations = await storage.getNearbyStations(latitude, longitude);
      
      // Add distance calculation
      const stationsWithDistance = stations.map(station => ({
        ...station,
        distance: calculateDistance(latitude, longitude, station.latitude, station.longitude)
      }));

      res.json(stationsWithDistance);
    } catch (error) {
      console.error("Stations API error:", error);
      res.status(500).json({ error: "Failed to fetch nearby stations" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

function getAQIStatus(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

function calculateAQI(pm25: number): number {
  // Simplified AQI calculation based on PM2.5
  // Standard AQI breakpoints for PM2.5
  if (pm25 <= 12.0) {
    return Math.round((50 / 12.0) * pm25);
  } else if (pm25 <= 35.4) {
    return Math.round(50 + ((100 - 50) / (35.4 - 12.1)) * (pm25 - 12.1));
  } else if (pm25 <= 55.4) {
    return Math.round(100 + ((150 - 100) / (55.4 - 35.5)) * (pm25 - 35.5));
  } else if (pm25 <= 150.4) {
    return Math.round(150 + ((200 - 150) / (150.4 - 55.5)) * (pm25 - 55.5));
  } else if (pm25 <= 250.4) {
    return Math.round(200 + ((300 - 200) / (250.4 - 150.5)) * (pm25 - 150.5));
  } else {
    return Math.round(300 + ((500 - 300) / (500.4 - 250.5)) * (pm25 - 250.5));
  }
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
