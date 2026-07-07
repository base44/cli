// @ts-check
import { defineConfig } from 'astro/config';
import wix from "@wix/astro";
import wixPages from "@wix/astro-pages";

import react from "@astrojs/react";
import cloudProviderFetchAdapter from "@wix/cloud-provider-fetch-adapter";
const isBuild = process.env.NODE_ENV == "production";

// https://astro.build/config
export default defineConfig({
  integrations: [wix(), wixPages(), react()],
  security: { checkOrigin: false },
  ...(isBuild && { adapter: cloudProviderFetchAdapter({}) }),

  image: {
    domains: ["static.wixstatic.com"],
  },

  output: "server",
});