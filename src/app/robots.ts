import type { MetadataRoute } from 'next'

/**
 * robots.ts — dashboard trading privat: TIDAK untuk diindeks mesin pencari.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  }
}
