import type { Metadata } from "next";
import {
  ArrowRight,
  Building2,
  Check,
  Code2,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Free forever",
  description:
    "All eight Pagelea PDF tools are free for manual use, with no account, online purchase flow or artificial task quota. The community code is open source.",
};

const FREE_FEATURES = [
  "All eight published PDF tools",
  "Local processing for document bytes",
  "No account or online purchase flow",
  "No hourly or daily task quota",
  "Source code under AGPL-3.0-or-later",
] as const;

const BUSINESS_OPTIONS = [
  {
    icon: Building2,
    title: "Enterprise",
    copy: "Discuss managed deployment, organisation controls, long-term support, security documentation and service commitments.",
    subject: "Pagelea Enterprise",
  },
  {
    icon: Code2,
    title: "SDK and OEM",
    copy: "Discuss a commercial licence for embedding Pagelea technology in a proprietary product, portal or branded workflow.",
    subject: "Pagelea SDK and OEM",
  },
  {
    icon: Wrench,
    title: "Services",
    copy: "Ask Inochi SRL for integrations, custom PDF workflows, deployment assistance or engineering support.",
    subject: "Pagelea professional services",
  },
] as const;

const FAQ = [
  [
    "Will the PDF tools stay free?",
    "Yes. The eight published consumer tools are free forever for manual use. Pagelea does not sell removal of hourly or daily task quotas.",
  ],
  [
    "Does free mean there are no technical limits?",
    "No. Safety limits still protect browser memory and responsiveness: up to 100 MB per PDF, 500 pages per PDF, and 20 files or 250 MB in a multi-file job. Some tools have additional documented format limits.",
  ],
  [
    "Why is Pagelea open source?",
    "Privacy should be inspectable. The community licence lets people read, audit, modify and redistribute the code under its terms. The Pagelea name and branding remain protected trademarks.",
  ],
  [
    "How does Pagelea plan to earn revenue?",
    "Inochi SRL plans to charge organisations for enterprise capabilities, commercial embedding licences, support, integrations and custom engineering—not for ordinary manual PDF work.",
  ],
] as const;

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <section className={styles.hero}>
          <div className="container">
            <p className="eyebrow">A free-forever promise</p>
            <h1 className="display">
              PDF work is free.
              <br />
              <em>No consumer paywall.</em>
            </h1>
            <p>
              Pagelea&apos;s eight published tools are available without an
              account or online purchase flow. Document bytes are processed
              locally in your browser, within transparent safety limits.
            </p>
          </div>
        </section>

        <section className={styles.promiseSection}>
          <div className={`${styles.promiseGrid} container`}>
            <article className={styles.freeCard}>
              <span className={styles.cardIcon} aria-hidden="true">
                <ShieldCheck size={28} />
              </span>
              <p className="eyebrow">Pagelea Community</p>
              <h2 className="display">€0</h2>
              <strong>Free forever for manual use</strong>
              <ul>
                {FREE_FEATURES.map((feature) => (
                  <li key={feature}>
                    <Check size={18} aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link className={styles.primaryAction} href="/#tools">
                Choose a PDF tool <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </article>

            <article className={styles.sourceCard}>
              <span className={styles.cardIcon} aria-hidden="true">
                <Code2 size={28} />
              </span>
              <p className="eyebrow">Open source</p>
              <h2 className="display">Trust, but verify.</h2>
              <p>
                Pagelea Community is licensed under AGPL-3.0-or-later. Inspect
                the local-processing path, review security controls, report
                issues and contribute improvements.
              </p>
              <a
                className={styles.secondaryAction}
                href="https://github.com/inochisrl/pagelea.com"
              >
                View the repository <ArrowRight size={18} aria-hidden="true" />
              </a>
              <small>
                The licence governs the code. The Pagelea name, logo and visual
                identity remain subject to the project&apos;s trademark policy.
              </small>
            </article>
          </div>
          <p className={`${styles.limitsNote} container`}>
            Safety limits are not usage quotas: PDFs are limited to 100 MB and
            500 pages; multi-file jobs to 20 files or 250 MB. Tool-specific
            checks can apply before expensive processing begins.
          </p>
        </section>

        <section className={styles.businessSection}>
          <div className="container">
            <div className={styles.sectionHeading}>
              <p className="eyebrow">Revenue without a consumer gate</p>
              <h2 className="display">Organisations pay for outcomes.</h2>
              <p>
                Pagelea has no self-service consumer purchase flow. Business
                work is scoped directly with Inochi SRL so organisations pay for
                deployment, control, integration and support.
              </p>
            </div>
            <div className={styles.businessGrid}>
              {BUSINESS_OPTIONS.map(({ icon: Icon, title, copy, subject }) => (
                <article key={title}>
                  <Icon size={25} aria-hidden="true" />
                  <h3 className="display">{title}</h3>
                  <p>{copy}</p>
                  <a
                    href={`mailto:hello@pagelea.com?subject=${encodeURIComponent(subject)}`}
                  >
                    Contact Inochi <ArrowRight size={17} aria-hidden="true" />
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.faq}>
          <div className={`${styles.faqInner} container`}>
            <div>
              <p className="eyebrow">Questions, answered</p>
              <h2 className="display">Free, with honest boundaries.</h2>
            </div>
            <div>
              {FAQ.map(([question, answer]) => (
                <details key={question}>
                  <summary>{question}</summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
