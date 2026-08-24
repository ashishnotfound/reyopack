import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Reyo Pack',
    short_name: 'Reyo Pack',
    description: 'Reyo Store warehouse packing and putaway operations',
    start_url: '/scan',
    display: 'standalone',
    background_color: '#0b1117',
    theme_color: '#0b1117',
    orientation: 'portrait-primary',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }],
  };
}
