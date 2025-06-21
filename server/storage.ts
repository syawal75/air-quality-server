import { 
  users, 
  airQualityData, 
  newsArticles, 
  airQualityStations,
  type User, 
  type InsertUser,
  type AirQualityData,
  type InsertAirQualityData,
  type NewsArticle,
  type InsertNewsArticle,
  type AirQualityStation,
  type InsertAirQualityStation
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getLatestAirQualityData(latitude: number, longitude: number): Promise<AirQualityData | undefined>;
  createAirQualityData(data: InsertAirQualityData): Promise<AirQualityData>;
  
  getAllNewsArticles(): Promise<NewsArticle[]>;
  createNewsArticle(article: InsertNewsArticle): Promise<NewsArticle>;
  
  getNearbyStations(latitude: number, longitude: number, radius?: number): Promise<AirQualityStation[]>;
  createAirQualityStation(station: InsertAirQualityStation): Promise<AirQualityStation>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private airQualityData: Map<number, AirQualityData>;
  private newsArticles: Map<number, NewsArticle>;
  private airQualityStations: Map<number, AirQualityStation>;
  private currentUserId: number;
  private currentAirQualityId: number;
  private currentNewsId: number;
  private currentStationId: number;

  constructor() {
    this.users = new Map();
    this.airQualityData = new Map();
    this.newsArticles = new Map();
    this.airQualityStations = new Map();
    this.currentUserId = 1;
    this.currentAirQualityId = 1;
    this.currentNewsId = 1;
    this.currentStationId = 1;
    
    // Initialize with sample news articles
    this.initializeSampleData();
  }

  private initializeSampleData() {
    // Sample news articles
    const sampleNews: Omit<NewsArticle, 'id'>[] = [
      {
        title: "Global Air Quality Standards Updated: What You Need to Know",
        excerpt: "The World Health Organization has announced new guidelines for air quality standards, affecting monitoring protocols worldwide...",
        content: "The World Health Organization has announced comprehensive updates to global air quality standards, introducing stricter guidelines that will affect monitoring protocols worldwide. These changes reflect the latest scientific research on air pollution's health impacts.",
        category: "Environment",
        imageUrl: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b",
        publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
      },
      {
        title: "How Air Quality Affects Your Daily Exercise Routine",
        excerpt: "Experts recommend adjusting outdoor activities based on real-time air quality readings...",
        content: "Health experts are increasingly recommending that people adjust their outdoor exercise routines based on real-time air quality readings. This guidance is particularly important for vulnerable populations.",
        category: "Health",
        imageUrl: "https://images.unsplash.com/photo-1581833971358-2c8b550f87b3",
        publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000) // 4 hours ago
      },
      {
        title: "New IoT Sensors Revolutionize Air Quality Monitoring",
        excerpt: "Advanced sensor networks provide more accurate and real-time environmental data...",
        content: "The deployment of advanced IoT sensor networks is revolutionizing how we monitor air quality, providing more accurate and comprehensive real-time environmental data than ever before.",
        category: "Technology",
        imageUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af2176",
        publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours ago
      },
      {
        title: "Study Links Indoor Air Quality to Productivity",
        excerpt: "Research shows significant correlation between air quality and workplace performance...",
        content: "A comprehensive study has revealed a significant correlation between indoor air quality and workplace productivity, with implications for office design and employee health.",
        category: "Research",
        imageUrl: "https://images.unsplash.com/photo-1497366216548-37526070297c",
        publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
      }
    ];

    sampleNews.forEach(article => {
      const id = this.currentNewsId++;
      this.newsArticles.set(id, { ...article, id });
    });

    // Sample air quality stations
    const sampleStations: Omit<AirQualityStation, 'id'>[] = [
      {
        name: "Downtown SF",
        latitude: 37.7749,
        longitude: -122.4094,
        aqi: 38,
        status: "Good"
      },
      {
        name: "Mission District",
        latitude: 37.7599,
        longitude: -122.4148,
        aqi: 65,
        status: "Moderate"
      },
      {
        name: "Golden Gate Park",
        latitude: 37.7694,
        longitude: -122.4862,
        aqi: 42,
        status: "Good"
      }
    ];

    sampleStations.forEach(station => {
      const id = this.currentStationId++;
      this.airQualityStations.set(id, { ...station, id });
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getLatestAirQualityData(latitude: number, longitude: number): Promise<AirQualityData | undefined> {
    // Find the most recent data for the given coordinates (with some tolerance)
    const tolerance = 0.01; // ~1km tolerance
    return Array.from(this.airQualityData.values())
      .filter(data => 
        Math.abs(data.latitude - latitude) < tolerance &&
        Math.abs(data.longitude - longitude) < tolerance
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  }

  async createAirQualityData(data: InsertAirQualityData): Promise<AirQualityData> {
    const id = this.currentAirQualityId++;
    const airQualityRecord: AirQualityData = { 
      ...data, 
      id, 
      timestamp: new Date(),
      pm25: data.pm25 ?? null,
      pm10: data.pm10 ?? null,
      no2: data.no2 ?? null,
      o3: data.o3 ?? null,
      so2: data.so2 ?? null,
      co: data.co ?? null
    };
    this.airQualityData.set(id, airQualityRecord);
    return airQualityRecord;
  }

  async getAllNewsArticles(): Promise<NewsArticle[]> {
    return Array.from(this.newsArticles.values())
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  async createNewsArticle(article: InsertNewsArticle): Promise<NewsArticle> {
    const id = this.currentNewsId++;
    const newsArticle: NewsArticle = { 
      ...article, 
      id, 
      publishedAt: new Date(),
      imageUrl: article.imageUrl ?? null
    };
    this.newsArticles.set(id, newsArticle);
    return newsArticle;
  }

  async getNearbyStations(latitude: number, longitude: number, radius: number = 50): Promise<AirQualityStation[]> {
    // Simple distance calculation (not precise but good for demo)
    return Array.from(this.airQualityStations.values())
      .filter(station => {
        const distance = Math.sqrt(
          Math.pow(station.latitude - latitude, 2) + 
          Math.pow(station.longitude - longitude, 2)
        ) * 111; // Rough conversion to km
        return distance <= radius;
      })
      .sort((a, b) => {
        const distanceA = Math.sqrt(
          Math.pow(a.latitude - latitude, 2) + 
          Math.pow(a.longitude - longitude, 2)
        );
        const distanceB = Math.sqrt(
          Math.pow(b.latitude - latitude, 2) + 
          Math.pow(b.longitude - longitude, 2)
        );
        return distanceA - distanceB;
      });
  }

  async createAirQualityStation(station: InsertAirQualityStation): Promise<AirQualityStation> {
    const id = this.currentStationId++;
    const airQualityStation: AirQualityStation = { ...station, id };
    this.airQualityStations.set(id, airQualityStation);
    return airQualityStation;
  }
}

export const storage = new MemStorage();
