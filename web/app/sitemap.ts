import { site } from "./lib/site";
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site, changeFrequency: "weekly", priority: 1 },
    { url: `${site}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${site}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
