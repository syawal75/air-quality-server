import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const airQualityData = pgTable("air_quality_data", {
  id: serial("id").primaryKey(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  aqi: integer("aqi").notNull(),
  pm25: real("pm25"),
  pm10: real("pm10"),
  no2: real("no2"),
  o3: real("o3"),
  so2: real("so2"),
  co: real("co"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const newsArticles = pgTable("news_articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  content: text("content").notNull(),
  category: text("category").notNull(),
  imageUrl: text("image_url"),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
});

export const airQualityStations = pgTable("air_quality_stations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  aqi: integer("aqi").notNull(),
  status: text("status").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertAirQualityDataSchema = createInsertSchema(airQualityData).omit({
  id: true,
  timestamp: true,
});

export const insertNewsArticleSchema = createInsertSchema(newsArticles).omit({
  id: true,
  publishedAt: true,
});

export const insertAirQualityStationSchema = createInsertSchema(airQualityStations).omit({
  id: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type AirQualityData = typeof airQualityData.$inferSelect;
export type InsertAirQualityData = z.infer<typeof insertAirQualityDataSchema>;
export type NewsArticle = typeof newsArticles.$inferSelect;
export type InsertNewsArticle = z.infer<typeof insertNewsArticleSchema>;
export type AirQualityStation = typeof airQualityStations.$inferSelect;
export type InsertAirQualityStation = z.infer<typeof insertAirQualityStationSchema>;
