# Runtime brand

Mahiro selected the existing Herdr Web terminal mark on 2026-10-19. The runtime
source is `public/favicon.svg`, byte-exact from Git `387ea2f:public/favicon.svg`.
SHA-256: `278964f3bb129696cc5138c7802bb5ea2d333b1c8320adf809a68f4058fd895f`.

Run `bash scripts/bun-project.sh scripts/generate-brand.ts` with installed
ImageMagick (`/opt/homebrew/bin/magick`, or `MAGICK_BIN`). The generator checks
the pinned SHA-256 of that source without requiring historical Git objects in a
shallow checkout, before exporting PNG/ICO icons, touch icons, padded
maskable icons and the alpha-only notification prompt. It does not redraw SVG
geometry. The installed ImageMagick renderer used for this export was observed
to inherit zero stroke opacity; the raster input explicitly supplies SVG's standard `stroke-opacity="1"` default
on the existing strokes, without changing source geometry or color. Rendering
supersamples at 1024px before downsampling to RGBA8. Focused tests decode PNG pixels
and require green chevron arms/vertex, blue underscore, dark background and the
badge's visible white prompt in their actual coordinate regions. Dimensions alone
are not fidelity evidence. Runtime URLs use `mahiro2`; the service-worker cache is `herdr-web-ui-v6-mahiro`.
This icon family includes the unchanged, vendored official Letta provider PNG.
Manifest identity, start URL, scope and push identity are unchanged.

The upstream ram source artwork, marketing site and README/film media pipeline
have been removed from this fork; their original paths and blobs remain in the
source manifest. They are not inputs to the runtime brand generator. The existing
`public/social-preview.png` and pinned upstream reference documents retain their
upstream provenance. Remote bridge messages and provider/native names are not
application-brand assets.
