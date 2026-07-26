import type { Metadata } from "next";
import {
  ArrowRight,
  Check,
  Clock3,
  HardDrive,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";
import PdfEditorWorkspace from "../../components/PdfEditorWorkspace";
import { ToolIcon } from "../../components/ToolIcon";
import { ToolWorkspace } from "../../components/ToolWorkspace";
import { getTool, TOOLS } from "../../lib/tools";
import styles from "./tool.module.css";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return TOOLS.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);

  if (!tool) return {};

  return {
    title: tool.title,
    description: tool.description,
  };
}

export default async function ToolPage({ params }: PageProps) {
  const { slug } = await params;
  const tool = getTool(slug);

  if (!tool) notFound();

  const steps = tool.howTo;
  const related = TOOLS.filter(
    (candidate) =>
      candidate.category === tool.category && candidate.slug !== tool.slug,
  ).slice(0, 3);

  return (
    <>
      <SiteHeader />
      <main
        id="main"
        className={styles.main}
        style={{ "--tool-accent": tool.accent } as CSSProperties}
      >
        <section className={styles.hero}>
          <div className={`${styles.heroInner} container`}>
            <span className={styles.heroIcon}>
              <ToolIcon name={tool.icon} size={27} />
            </span>
            <p className="eyebrow">{tool.category}</p>
            <h1 className="display">{tool.title}</h1>
            <p className={styles.subtitle}>{tool.subtitle}</p>
            <div className={styles.languageNotice}>
              <ShieldCheck size={16} />
              Private by design — document bytes stay in this browser
            </div>
          </div>
          <div className={styles.wave} aria-hidden="true" />
        </section>

        <section className={styles.workspaceSection}>
          <div
            className={`${styles.workspaceWrap} ${
              slug === "pdf-editor" ||
              slug === "sign-pdf" ||
              slug === "organize-pdf"
                ? styles.editorWorkspaceWrap
                : ""
            } container`}
          >
            {slug === "pdf-editor" ||
            slug === "sign-pdf" ||
            slug === "organize-pdf" ? (
              <PdfEditorWorkspace
                mode={
                  slug === "sign-pdf"
                    ? "sign"
                    : slug === "organize-pdf"
                      ? "organize"
                      : "edit"
                }
              />
            ) : (
              <ToolWorkspace tool={tool} />
            )}
            <div className={styles.trustStrip}>
              <span>
                <LockKeyhole size={17} />
                Private browser workspace
              </span>
              <span>
                <HardDrive size={17} />
                Local-first processing
              </span>
              <span>
                <Clock3 size={17} />
                Clears when you leave
              </span>
            </div>
            {slug === "flatten-pdf" ? (
              <div className={styles.destructiveNotice}>
                <TriangleAlert size={18} aria-hidden="true" />
                <p>
                  Work on a copy. Sanitizing intentionally removes annotations,
                  links, bookmarks, attachments, scripts, actions, and
                  metadata; verify form values and page appearance afterward.
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className={styles.guideSection}>
          <div className={`${styles.guideInner} container`}>
            <div className={styles.guideIntro}>
              <p className="eyebrow">How it works</p>
              <h2 className="display">{tool.guideTitle}</h2>
              <p>{tool.description}</p>
            </div>
            <ol className={styles.steps}>
              {steps.map((step, index) => (
                <li key={`${index}-${step}`}>
                  <span className="display">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p>{step}</p>
                  <Check size={18} />
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.privacySection}>
          <div className={`${styles.privacyInner} container`}>
            <div className={styles.lockVisual} aria-hidden="true">
              <span />
              <LockKeyhole size={34} />
            </div>
            <div>
              <p className="eyebrow">Your documents, your device</p>
              <h2 className="display">Private work should stay private.</h2>
              <p>
                Every published Pagelea tool processes document bytes in this
                browser. There is no document-upload endpoint or cloud document
                library, and refreshing the page clears the workspace.
              </p>
              <Link href="/security">
                Read about security <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </section>

        {related.length ? (
          <section className={styles.relatedSection}>
            <div className="container">
              <div className={styles.relatedHeading}>
                <div>
                  <p className="eyebrow">Keep working</p>
                  <h2 className="display">Related tools</h2>
                </div>
                <Link href="/#tools">
                  View every tool <ArrowRight size={17} />
                </Link>
              </div>
              <div className={styles.relatedGrid}>
                {related.map((candidate) => (
                  <Link
                    href={`/tools/${candidate.slug}`}
                    key={candidate.slug}
                    style={
                      { "--related-accent": candidate.accent } as CSSProperties
                    }
                  >
                    <span>
                      <ToolIcon
                        name={candidate.icon}
                        size={21}
                      />
                    </span>
                    <strong>{candidate.title}</strong>
                    <p>{candidate.description}</p>
                    <ArrowRight size={17} />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
