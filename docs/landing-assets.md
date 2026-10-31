# Scout landing-page assets

All landing-page images and fonts are served from `public/landing/`. Visitors do not contact a stock-photo or font provider. Photos show illustrative products; they are not actual user listings, endorsements, or live availability. Example prices and alert previews are labeled accordingly.

## Photography

Downloaded on 29 October 2026 from Pexels, whose [license](https://www.pexels.com/license/) permits free use and modification. Creator and source links are retained here for attribution and provenance.

| Local asset | Photographer and original photo | Download transformation |
| --- | --- | --- |
| `film-camera.webp` | [Yelena from Pexels — Retro photo camera on table](https://www.pexels.com/photo/retro-photo-camera-on-table-7162551/) | [Pexels image CDN](https://images.pexels.com/photos/7162551/pexels-photo-7162551.jpeg?auto=compress&cs=tinysrgb&w=1000&fm=webp&q=82), width 1000, WebP, quality 82 |
| `leather-jacket.webp` | [Daniel Maurício Bertoli — Black Leather Jacket on Hangers in Closet](https://www.pexels.com/photo/black-leather-jacket-on-hangers-in-closet-37595197/) | [Pexels image CDN](https://images.pexels.com/photos/37595197/pexels-photo-37595197.jpeg?auto=compress&cs=tinysrgb&w=700&fm=webp&q=80), width 700, WebP, quality 80 |
| `sneakers.webp` | [Melvin Buezo — Photo of Sneakers on White Background](https://www.pexels.com/photo/photo-of-sneakers-on-white-background-2529148/) | [Pexels image CDN](https://images.pexels.com/photos/2529148/pexels-photo-2529148.jpeg?auto=compress&cs=tinysrgb&w=600&fm=webp&q=80), width 600, WebP, quality 80 |

The layout crops photos using `object-fit`; it does not edit their contents. Fixed dimensions reserve space before loading. Only the hero image has high fetch priority; below-the-fold photography is lazy loaded. The same asset is reused from the browser cache for demo thumbnails.

## Typography

`dm-sans.woff2` is the Latin variable-weight subset of DM Sans, obtained from [Fontsource Variable DM Sans 5.2.8](https://cdn.jsdelivr.net/npm/@fontsource-variable/dm-sans@5.2.8/files/dm-sans-latin-wght-normal.woff2). The [Google Fonts source](https://github.com/google/fonts/tree/main/ofl/dmsans) provides the SIL Open Font License, copied to `public/landing/dm-sans-LICENSE.txt`. The design uses heavier display weights and readable body sizes; `font-display: swap` permits immediate text rendering.

## Motion and design references

[MotionSites](https://motionsites.ai/), [FlowSolutions](https://flow-solutions.xyz/) and [LeadGen by FlowSolutions](https://leadgen.flow-solutions.xyz/) informed the emphasis on clear type, purposeful process demonstrations, and visible state transitions. No source code, brand elements, copy, or assets were copied from those sites.

Scout's demonstration animates listing → criteria match → notification, then stops. It runs only while in view and the browser tab is visible. Visitors can select stages, replay or pause, preview the default Scout feed, and explore optional email and private Telegram destinations. Reduced-motion preference disables autoplay and transform entrances. The demonstration uses local example state and sends no notifications.
