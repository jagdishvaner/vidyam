import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.VIDYAM_DATABASE_ADMIN_URL ?? "postgresql://vidyam:vidyam@localhost:38130/vidyam",
  },
});
