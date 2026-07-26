import type { MetadataRoute } from "next";
import { TOOLS } from "./lib/tools";

const ORIGIN = "https://pagelea.com";
const PUBLIC_PAGES = [
  "",
  "/pricing",
  "/about",
  "/security",
  "/privacy",
  "/terms",
  "/cookies",
  "/help",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = PUBLIC_PAGES.map((path) => ({
    url: `${ORIGIN}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/pricing" ? 0.75 : 0.5,
  }));
  const tools: MetadataRoute.Sitemap = TOOLS.map((tool) => ({
    url: `${ORIGIN}/tools/${tool.slug}`,
    changeFrequency: "monthly",
    priority: tool.slug === "pdf-editor" ? 0.9 : 0.7,
  }));
  return [...staticPages, ...tools];
}
