import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api",
        "/callback",
        "/signin-with-chatgpt",
        "/signout-with-chatgpt",
      ],
    },
    sitemap: "https://pagelea.com/sitemap.xml",
    host: "https://pagelea.com",
  };
}
