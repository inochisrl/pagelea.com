# Third-party notices

Pagelea includes and depends on third-party software. Those components are
licensed by their respective copyright holders under their own terms; they are
not relicensed under Pagelea's AGPL licence.

This notice summarizes the locked dependency graph as reviewed on
2026-07-26. The lockfile and generated SBOM are authoritative for a particular
build.

## Direct runtime dependencies

| Component | Locked version | Declared licence |
| --- | ---: | --- |
| `lucide-react` | 1.26.0 | ISC |
| `next` | 16.2.11 | MIT |
| `pako` | 3.0.1 | MIT AND Zlib |
| `pdf-lib` | 1.17.1 | MIT |
| `pdfjs-dist` | 6.1.200 | Apache-2.0 |
| `react` | 19.2.8 | MIT |
| `react-dom` | 19.2.8 | MIT |

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
- LGPL-3.0-or-later.

The LGPL entry is the platform-specific `libvips` package used by Sharp in the
development/build dependency graph. It is not a Pagelea browser runtime
library. Anyone distributing a build that contains that native library must
evaluate and satisfy its LGPL obligations.

The metadata review found no package with missing licence metadata and no
known vulnerability in either the full or production dependency audit at the
time recorded above. This is not a legal opinion and does not replace review
of the complete licence texts for a release.

## Reproducing the inventory

```bash
npm ci
npm run licenses:list -- > /tmp/pagelea-dependencies.json
npm run sbom -- > /tmp/pagelea-sbom.cdx.json
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
```

See [docs/SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md) for release requirements.
