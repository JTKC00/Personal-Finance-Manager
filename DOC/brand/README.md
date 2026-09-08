# PFM brand icon

The blue-and-white P / wallet monogram is shared by the favicon, in-app brand mark, and installed PWA icon.

Source: `pfm-master.png` (1254 × 1254 RGB), generated with the built-in ImageGen tool. Runtime exports are in `public/brand/`. macOS `sips` exports sizes from the same master; `public/favicon.ico` packages the 16, 32 and 48px PNG frames. Keep the master out of public assets so it does not inflate offline caching.

- Favicon: 16, 32, 48px plus ICO.
- In-app brand: 128px source, displayed at 36px / 52px.
- iPhone Home Screen: 180px Apple Touch Icon.
- PWA: 192 and 512px; the 512px mark is also safe for maskable use.
- Compatibility: the original `/icon-192.png` and `/icon-512.png` paths contain the same new artwork.

The opaque icon uses full-bleed blue. Do not bake rounded outer corners into phone assets: the operating system supplies its mask. The white mark fits within the central circle with radius 40% of the image width (verified on the 512px export).

References:
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons
- https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html

## Generation prompt

Create the single production master app icon for PFM (Personal Finance Manager), a refined minimalist personal finance app. Square 1024 x 1024 artwork. Full-bleed perfectly flat solid cobalt blue background approximately #0066CC extending to all four edges, NO rounded outer square, NO border, NO transparency. In the exact center place ONE distinctive white geometric monogram P: a bold softly rounded vertical stem joining a rounded rectangular upper bowl, with a very simple open negative-space counter reminiscent of a wallet or ledger. Elegant Apple-like restraint but original, not an Apple logo. One strong flat white silhouette, clean precise edges, generous breathing room. The whole white mark must fit inside the central 60% of canvas width AND height so it remains safe within circular Android maskable crops. Strong readability when reduced to 16px. Flat vector-like graphic, no perspective, no gradients, no shadows, no fine strokes, no coins, no dollar signs, no extra letters, no text captions, no grid, no mockup, no multiple variants. Deliver only the finished square blue-and-white icon.
