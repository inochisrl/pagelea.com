# Third-party notices

Pagelea includes and depends on third-party software. Those components are
licensed by their respective copyright holders under their own terms; they are
not relicensed under Pagelea's AGPL licence.

This notice summarizes the locked dependency graph as reviewed on
2026-07-27. The lockfile and generated SBOM are authoritative for a particular
build.

## Direct production dependencies

| Component | Locked version | Declared licence |
| --- | ---: | --- |
| `@pdf-lib/fontkit` | 1.1.1 | MIT |
| `lucide-react` | 1.26.0 | ISC |
| `next` | 16.2.11 | MIT |
| `pako` | 3.0.1 | MIT AND Zlib |
| `patch-package` | 8.0.1 | MIT |
| `pdf-lib` | 1.17.1 | MIT |
| `pdfjs-dist` | 6.1.200 | Apache-2.0 |
| `react` | 19.2.8 | MIT |
| `react-dom` | 19.2.8 | MIT |
| `tesseract.js` | 7.0.0 | Apache-2.0 |

## Direct development dependencies

The direct development toolchain is declared under MIT, Apache-2.0, or
`MIT OR Apache-2.0` terms. This includes Cloudflare's Vite plugin, ESLint,
Next.js tooling, Tailwind CSS, TypeScript, Vite, vinext, and Wrangler. Exact
versions are recorded in `package-lock.json`.

## Bundled PDF.js assets

The repository carries PDF.js worker, CMap, font, and WebAssembly assets so the
browser can process PDFs without a third-party CDN.

| Asset family | Licence or notice |
| --- | --- |
| PDF.js worker and project glue | Apache-2.0 |
| Adobe CMaps | BSD 3-clause-style notice |
| Foxit/PDFium standard fonts | BSD 3-clause-style notice |
| Liberation fonts | SIL Open Font License 1.1 |
| JBIG2 components | BSD 3-clause-style and Apache-2.0 notices |
| OpenJPEG components | BSD-2-Clause notices |
| qcms components | MIT and BSD-2-Clause notices |

The complete notices are retained beside the assets under
`public/pdfjs/**/LICENSE*`. Redistributors must retain those files.

The pako MIT and zlib notices are retained at
`public/licenses/pako-LICENSE.txt` and copied into the production build.

## Private Rewrite OCR and Unicode assets

Private Rewrite keeps its OCR runtime, English and Italian recognition data,
and PDF export fonts under `public/private-rewrite/`. These files are served
from Pagelea's own origin so a document never needs to be sent to an OCR or
font CDN.

| Shipped asset family | Reviewed upstream revision | Licence | Retained licence |
| --- | --- | --- | --- |
| Tesseract.js browser worker 7.0.0 and its generated licence sidecar | `naptha/tesseract.js` commit `42eae669e4b3a66429d8516f078912cc747a89df` | Apache-2.0, MIT, and BSD-3-Clause | Tesseract, buffer, ieee754, regenerator-runtime, and zlibjs texts under `public/licenses/private-rewrite/` |
| Tesseract.js Core WebAssembly loaders 7.0.0 | `naptha/tesseract.js-core` commit `acffef2b66eb44a31df297e11d905f4b39001068` | Apache-2.0 | `public/licenses/private-rewrite/tesseract-js-core-Apache-2.0.txt` |
| English and Italian `tessdata_fast` models | `tesseract-ocr/tessdata_fast` commit `87416418657359cb625c412a48b6e1d6d41c29bd` | Apache-2.0 | `public/licenses/private-rewrite/tessdata-fast-Apache-2.0.txt` |
| Noto Sans, Serif, Mono, Symbols 2, Arabic, and Hebrew fonts | `notofonts/noto-fonts` commit `ffebf8c1ee449e544955a7e813c54f9b73848eac` | SIL Open Font License 1.1 | `public/licenses/private-rewrite/noto-fonts-OFL-1.1.txt` |
| Noto Sans JP variable font | `google/fonts` commit `295d98a7a0c17c68f1341eaeea354e7960ea70d3` | SIL Open Font License 1.1 | `public/licenses/private-rewrite/google-fonts-noto-sans-jp-OFL-1.1.txt` |

The Tesseract worker and core files are copied verbatim from their locked npm
packages. The trained-data files and fonts are copied verbatim from the pinned
repositories. The worker bundle also contains the pinned `buffer@6.0.3`,
`ieee754@1.2.1`, `regenerator-runtime@0.13.11`, and `zlibjs@0.3.1`
components. Their exact package integrities, source revisions, transformations,
licences, and retained licence hashes are recorded in the asset manifest.

Pagelea applies the reviewed source patch
`patches/tesseract.js+7.0.0.patch` to the Apache-2.0-licensed
`tesseract.js@7.0.0` package during `npm ci`. The patch adds abort-aware image
loading, deterministic worker cleanup when bootstrap fails or is cancelled,
prompt rejection and cleanup after a runtime worker crash, robust
video/canvas input cancellation, and transferable recognition buffers. It
does not modify the copied worker, core, language-model, or font assets listed
above. The patch remains covered by the upstream Apache-2.0 notice.
`patch-package@8.0.1` is an MIT-licensed install-time tooling dependency. It is
included in the dependency licence inventory and SBOM but is not imported into
the browser application.

Every shipped Private Rewrite asset, including
`ocr/worker.min.js.LICENSE.txt`, is recorded with its byte size, SHA-256,
upstream path, commit, transformation, and licence in
`config/private-rewrite-assets.v1.json`. The verifier rejects path traversal,
symbolic links, unexpected or missing files, provenance changes, oversized
assets, size mismatches, and digest mismatches:

```bash
node scripts/verify-private-rewrite-assets.mjs
```

## Web interface fonts

The generated web build contains Bricolage Grotesque and Manrope selected by
the Pagelea interface. The vinext font build can also emit Geist and Geist Mono
assets as framework-managed font resources. These fonts are distributed under
the SIL Open Font License 1.1.

| Font family | Copyright notice |
| --- | --- |
| Bricolage Grotesque | Copyright 2022 The Bricolage Grotesque Project Authors |
| Manrope | Copyright 2018 The Manrope Project Authors |
| Geist and Geist Mono | Copyright © 2023 Vercel, in collaboration with basement.studio |

The copyright notices and complete licence text are shipped at
`public/licenses/ui-fonts-OFL-1.1.txt` and copied into every production build.

## Transitive dependency review

`npm query '*' --json` reported the following SPDX expressions across the
installed graph:

- MIT;
- Apache-2.0;
- ISC;
- BSD-2-Clause and BSD-3-Clause;
- MPL-2.0;
- 0BSD;
- `MIT OR Apache-2.0`;
- `MIT AND Zlib`;
- BlueOak-1.0.0;
- CC-BY-4.0 and CC0-1.0;
- LGPL-3.0-or-later;
- Public Domain.

The LGPL entry is the platform-specific `libvips` package used by Sharp in the
development/build dependency graph. It is not a Pagelea browser runtime
library. Anyone distributing a build that contains that native library must
evaluate and satisfy its LGPL obligations.

The Public Domain entry is `jsonify@0.0.1`, an install-time transitive
dependency of the pinned `patch-package` release. Its package metadata and
included README both declare the implementation public domain. It is not
imported into the Pagelea browser runtime.

The metadata review found no package with missing licence metadata and no
known vulnerability in either the full or production dependency audit at the
time recorded above. This is not a legal opinion and does not replace review
of the complete licence texts for a release.

## Reproducing the inventory

```bash
npm ci
npm run licenses:list -- > /tmp/pagelea-dependencies.json
npm run sbom -- > /tmp/pagelea-sbom.cdx.json
node scripts/verify-private-rewrite-assets.mjs
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
```

See [docs/SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md) for release requirements.
