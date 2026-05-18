import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://www.chainlesschain.com',
  integrations: [tailwind()],
  build: {
    assets: 'assets',
  },
});
