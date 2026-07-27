import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Laptop,
  LockKeyhole,
  MousePointer2,
  Sparkles,
  Star,
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { TOOLS, type ToolCategory } from "../lib/tools";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { ToolIcon } from "./ToolIcon";
import styles from "./HomePage.module.css";

const FEATURED = [
  "pdf-editor",
  "merge-pdf",
  "organize-pdf",
  "split-pdf",
] as const;

const CATEGORY_ORDER = [
  "Merge",
  "Split",
  "Edit & Sign",
  "Optimize",
  "Security",
  "Convert to PDF",
] as const satisfies readonly ToolCategory[];

const CATEGORY_TONES: Record<string, string> = {
  Merge: "#0f9f6e",
  Split: "#76931a",
  "Edit & Sign": "#2d6fe8",
  Optimize: "#e26b38",
  Security: "#7057d9",
  "Convert to PDF": "#b14b9d",
};

const GUIDES = [
  {
    number: "01",
    title: "Rewrite native or scanned PDF text",
    copy: "Click existing text or recognize an English or Italian scan locally, then rewrite the selected line.",
    slug: "pdf-editor",
    tone: "mint",
  },
  {
    number: "02",
    title: "Combine a folder of PDFs in the right order",
    copy: "Add files, arrange them visually, and build one continuous document in a few clicks.",
    slug: "merge-pdf",
    tone: "blue",
  },
  {
    number: "03",
    title: "Optimize a PDF without vague quality claims",
    copy: "Clean and repack its internal structure, then keep whichever safe version is smaller.",
    slug: "compress-pdf",
    tone: "orange",
  },
];

function getTool(slug: string) {
  return TOOLS.find((tool) => tool.slug === slug);
}

function ToolCard({
  tool,
  compact = false,
}: {
  tool: (typeof TOOLS)[number];
  compact?: boolean;
}) {
  return (
    <Link
      className={`${styles.toolCard} ${compact ? styles.compactCard : ""}`}
      href={`/tools/${tool.slug}`}
      style={{ "--tool-accent": tool.accent } as CSSProperties}
    >
      <span className={styles.toolIcon}>
        <ToolIcon name={tool.icon} size={compact ? 19 : 22} />
      </span>
      <span className={styles.toolCopy}>
        <strong>{tool.title}</strong>
        <small>{tool.description}</small>
      </span>
      <ChevronRight className={styles.cardArrow} size={18} />
    </Link>
  );
}

export function HomePage() {
  const featuredTools = FEATURED.map(getTool).filter(
    (tool): tool is (typeof TOOLS)[number] => Boolean(tool),
  );

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className={styles.hero}>
          <div className={`${styles.heroInner} container`}>
            <div className={styles.heroCopy}>
              <div className={`${styles.localBadge} reveal`}>
                <Code2 size={16} />
                Free and open-source
              </div>
              <h1 className="display reveal">
                Change PDF text,
                <br />
                <em>without uploading it.</em>
              </h1>
              <p className={`${styles.heroLead} reveal`}>
                Pagelea rewrites supported native and scanned text, then
                handles seven more everyday PDF jobs locally in your browser.
                Free and open source, with no account or artificial task quota.
              </p>
              <div className={`${styles.heroActions} reveal`}>
                <Link className="button-primary" href="/tools/pdf-editor">
                  Edit a PDF <ArrowRight size={18} />
                </Link>
                <a className="button-secondary" href="#tools">
                  Browse 8 tools
                </a>
              </div>
              <div className={`${styles.heroTrust} reveal`}>
                <span>
                  <Check size={15} /> Free forever
                </span>
                <span>
                  <Check size={15} /> No account
                </span>
                <span>
                  <Check size={15} /> No server upload
                </span>
              </div>
            </div>

            <div className={styles.paperStage} aria-hidden="true">
              <span className={styles.dotField} />
              <div className={`${styles.paper} ${styles.paperBack}`}>
                <span>Contract_2026.pdf</span>
                <i />
                <i />
                <i />
              </div>
              <div className={`${styles.paper} ${styles.paperMiddle}`}>
                <span>Q3_notes.pdf</span>
                <i />
                <i />
                <i />
              </div>
              <div className={`${styles.paper} ${styles.paperFront}`}>
                <div className={styles.paperToolbar}>
                  <span />
                  <span />
                  <span />
                </div>
                <b className="display">A cleaner way to PDF.</b>
                <i />
                <i />
                <i className={styles.shortLine} />
                <div className={styles.signature}>Pagelea</div>
                <div className={styles.paperTag}>
                  <Sparkles size={15} /> Ready to export
                </div>
              </div>
              <div className={styles.cursorChip}>
                <MousePointer2 size={15} fill="currentColor" />
                you
              </div>
            </div>
          </div>
          <div className={styles.heroTicker}>
            <div>
              <span>Merge</span>
              <i>•</i>
              <span>Optimize</span>
              <i>•</i>
              <span>Edit</span>
              <i>•</i>
              <span>Convert</span>
              <i>•</i>
              <span>Sign</span>
              <i>•</i>
              <span>Organise</span>
              <i>•</i>
              <span>Merge</span>
              <i>•</i>
              <span>Optimize</span>
            </div>
          </div>
        </section>

        <section className={styles.toolsSection} id="tools">
          <div className="container">
            <div className={styles.sectionHeading}>
              <div>
                <p className="eyebrow">Pick a tool, finish the job</p>
                <h2 className="display">The production workbench.</h2>
              </div>
              <p>
                Each tool opens into the same calm workflow: choose files,
                adjust what matters, download the result.
              </p>
            </div>

            <div className={styles.popularBlock}>
              <h3>Start here</h3>
              <div className={styles.popularGrid}>
                {featuredTools.map((tool) => (
                  <ToolCard key={tool.slug} tool={tool} />
                ))}
              </div>
            </div>

            <div className={styles.catalogue}>
              {CATEGORY_ORDER.map((category) => {
                const tools = TOOLS.filter((tool) => tool.category === category);
                if (!tools.length) return null;
                return (
                  <section
                    className={styles.category}
                    key={category}
                    style={
                      {
                        "--category-tone": CATEGORY_TONES[category],
                      } as CSSProperties
                    }
                  >
                    <div className={styles.categoryTitle}>
                      <span />
                      <h3>{category}</h3>
                      <small>{tools.length} tools</small>
                    </div>
                    <div className={styles.categoryGrid}>
                      {tools.map((tool) => (
                        <ToolCard compact key={tool.slug} tool={tool} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </section>

        <section className={styles.ratingSection}>
          <div className={`${styles.ratingInner} container`}>
            <div className={styles.ratingScore}>
              <strong className="display">8</strong>
              <div>
                <span>
                  <Star size={17} fill="currentColor" />
                </span>
                <small>working beta workflows</small>
              </div>
            </div>
            <blockquote>
              No placeholder conversions. Every tool shown here performs the
              work it promises.
            </blockquote>
            <div className={styles.ratingFacts}>
              <span>
                <LockKeyhole size={18} />
                Local-first processing
              </span>
              <span>
                <Sparkles size={18} />
                100 MB PDF safety limit
              </span>
            </div>
          </div>
        </section>

        <section className={styles.modeSection}>
          <div className="container">
            <div className={styles.modeHeading}>
              <p className="eyebrow">Works the way you work</p>
              <h2 className="display">Private tools. Verifiable code.</h2>
            </div>
            <div className={styles.modeGrid}>
              <article className={styles.webMode}>
                <div className={styles.modeVisual}>
                  <Laptop size={48} strokeWidth={1.25} />
                  <span className={styles.modeFile}>PDF</span>
                </div>
                <div>
                  <span className={styles.modeLabel}>Pagelea Community</span>
                  <h3 className="display">Free stays useful.</h3>
                  <p>
                    All eight published tools are free for manual document
                    work. There is no account or hourly task quota; documented
                    safety limits protect your browser tab.
                  </p>
                  <Link href="/pricing">
                    Read the free-forever promise <ArrowRight size={17} />
                  </Link>
                </div>
              </article>

              <article className={styles.sourceMode}>
                <div className={styles.modeVisual}>
                  <Code2 size={52} strokeWidth={1.25} />
                  <span className={styles.modeFile}>CODE</span>
                </div>
                <div>
                  <span className={styles.modeLabel}>Pagelea Open Source</span>
                  <h3 className="display">Inspect the privacy claim.</h3>
                  <p>
                    The community code is available under AGPL-3.0-or-later.
                    Read it, audit it, improve it, or build with it under the
                    repository licence.
                  </p>
                  <a href="https://github.com/inochisrl/pagelea.com">
                    View the source <ArrowRight size={17} />
                  </a>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.guidesSection}>
          <div className="container">
            <div className={styles.guideHeading}>
              <p className="eyebrow">No manual required</p>
              <h2 className="display">Three jobs. Three simple paths.</h2>
            </div>
            <div className={styles.guideList}>
              {GUIDES.map((guide) => (
                <article
                  className={`${styles.guide} ${styles[guide.tone]}`}
                  key={guide.number}
                >
                  <span className={`${styles.guideNumber} display`}>
                    {guide.number}
                  </span>
                  <div>
                    <h3 className="display">{guide.title}</h3>
                    <p>{guide.copy}</p>
                  </div>
                  <Link href={`/tools/${guide.slug}`} aria-label={guide.title}>
                    Try it <ArrowRight size={17} />
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.finalCta}>
          <div className={`${styles.finalCtaInner} container`}>
            <div>
              <p className="eyebrow">One document away</p>
              <h2 className="display">Make the next PDF the easy one.</h2>
            </div>
            <Link className="button-primary" href="/tools/pdf-editor">
              Choose a file <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
