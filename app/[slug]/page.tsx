import type { Metadata } from "next";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  HeartHandshake,
  LockKeyhole,
  Scale,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import styles from "./info.module.css";

type PageProps = {
  params: Promise<{ slug: string }>;
};

const PAGES = {
  about: {
    eyebrow: "About Pagelea",
    title: "Documents are serious. PDF software doesn’t have to be.",
    lead: "Pagelea is an independent Inochi SRL product: free, open-source PDF software built around calm workflows and inspectable privacy.",
    updated: "27 July 2026",
    icon: HeartHandshake,
    sections: [
      [
        "Operator and contact",
        "Pagelea is operated by Inochi Srl, Via Alessandro Stradella 15, 20129 Milan, Italy. VAT number IT 10196520968, REA MI 2512487, share capital €10,000. Product and privacy enquiries can be sent to hello@pagelea.com.",
      ],
      [
        "Free forever for manual work",
        "The eight published consumer tools are available without registration or an online purchase flow. Pagelea uses documented file, page, image and memory limits to protect the browser rather than hourly or daily task quotas.",
      ],
      [
        "Private by architecture",
        "The published workflows process document bytes locally in the browser. Pagelea does not provide a document-upload API or persistent document library.",
      ],
      [
        "Open source, protected identity",
        "The community code is available under AGPL-3.0-or-later so its behaviour can be inspected and improved. That software licence does not grant rights to the Pagelea name, logo or visual identity, which remain subject to the project trademark policy.",
      ],
      [
        "Built independently",
        "Pagelea uses original branding, copy, layout and components. It is not affiliated with, sponsored by or endorsed by Sejda BV.",
      ],
    ],
  },
  security: {
    eyebrow: "Security",
    title: "Your files deserve a short trip.",
    lead: "For the eight published workflows, document bytes stay inside your browser. Pagelea’s open-source, local-processing architecture reduces the systems that can receive a private file.",
    updated: "27 July 2026",
    icon: ShieldCheck,
    sections: [
      [
        "Local document processing",
        "The eight published workflows process document bytes on your device. The Worker has no document-upload, remote conversion or persistent file-library endpoint.",
      ],
      [
        "Verifiable implementation",
        "Pagelea Community is open source under AGPL-3.0-or-later. Reviewers can inspect the document path, resource limits and network boundaries instead of relying only on a privacy claim.",
      ],
      [
        "Bounded, defensive parsing",
        "Pagelea limits file count, bytes, pages, decoded image pixels, editor elements, text and nested PDF objects before expensive work. Unsupported or over-limit input fails closed with a specific error.",
      ],
      [
        "A deliberately small server surface",
        "Only optional aggregate analytics ingestion and an allowlisted administrative analytics read are routed through the public Worker. API methods and request bodies are bounded and allowlisted, unknown paths fail closed, and responses receive restrictive security headers.",
      ],
      [
        "Responsible reporting",
        "Report a suspected vulnerability to hello@pagelea.com with reproducible steps, affected paths and expected impact. Do not include credentials, private documents or unnecessary personal data, and do not test against systems or data you do not own.",
      ],
      [
        "Honest limits",
        "Sanitize & Flatten reduces the active structures covered by its documented checks, but no PDF tool can certify that an adversarial file is harmless. Private Rewrite can recognize English and Italian scans locally; OCR accuracy, complex fonts, and complex layouts still require manual review.",
      ],
    ],
  },
  privacy: {
    eyebrow: "Privacy",
    title: "The shortest privacy policy is the best architecture.",
    lead: "This notice explains how Inochi Srl handles personal data when you visit Pagelea, use the local PDF workspace or contact the company.",
    updated: "27 July 2026",
    icon: LockKeyhole,
    sections: [
      [
        "Controller and contact",
        "The data controller is Inochi Srl, Via Alessandro Stradella 15, 20129 Milan, Italy; VAT IT 10196520968; REA MI 2512487. Contact hello@pagelea.com for privacy questions or to exercise your rights.",
      ],
      [
        "Documents stay local",
        "Selected documents, filenames, extracted text, signatures and generated files remain in your browser for the eight published workflows. Pagelea has no document-upload API, registration-based document library or persistent file-storage bucket.",
      ],
      [
        "Aggregate product analytics",
        "Anonymous browser analytics is privacy fail-closed and disabled in the current source build. If both the source and Worker controls are deliberately enabled, Pagelea stores only daily counts with allowlisted event names and normalized path, tool or non-identifying “none” dimensions. It does not put identity fields, IP addresses, user agents, referrers, cookies or document data in the analytics table.",
      ],
      [
        "Hosting and security data",
        "OpenAI ChatGPT Sites and its hosting infrastructure process technical request data such as network addresses, headers, timestamps and security signals to deliver and protect the site. Pagelea does not copy those technical identifiers into its product-analytics database.",
      ],
      [
        "Messages and business enquiries",
        "If you email Inochi SRL, the company processes your address, message and any information you choose to provide to answer the request, scope a service or establish a business relationship. Do not attach confidential originals unless they are strictly necessary; a redacted sample is preferred.",
      ],
      [
        "Purposes and legal bases",
        "Hosting security, abuse prevention and minimal aggregate measurement support Inochi’s legitimate interests in protecting and improving Pagelea. Messages are processed to answer your request, take requested pre-contract steps or perform an agreed service. Legal records are retained where necessary to comply with applicable obligations.",
      ],
      [
        "Recipients and transfers",
        "OpenAI provides ChatGPT Sites hosting infrastructure and processes hosted Pagelea data under the applicable terms and data-processing addendum. Email, infrastructure and professional service providers receive only the data needed for their role. Applicable transfer safeguards include an adequacy decision or the European Commission’s Standard Contractual Clauses where required.",
      ],
      [
        "Retention",
        "Pagelea does not retain document content. Aggregate analytics is limited to a rolling 90-day reporting window and older rows are deleted on the next aggregate write. Support and business correspondence is kept only as long as needed to answer the request, perform the service, resolve disputes or meet legal obligations.",
      ],
      [
        "Your choices and rights",
        "You can use all eight published tools without registration. Subject to applicable law, you can request access, correction, erasure, restriction or portability, or object to processing, by writing to hello@pagelea.com. You may also complain to the Italian Data Protection Authority.",
      ],
      [
        "Age and policy changes",
        "Pagelea is not directed to children under 16 in the European Union or below the applicable digital-consent age elsewhere. Material changes to this notice will be published here with a new effective date before they apply where required.",
      ],
    ],
  },
  terms: {
    eyebrow: "Terms",
    title: "Fair tools need fair terms.",
    lead: "Effective 26 July 2026. These Terms govern use of the Pagelea website and its eight published PDF workflows, operated by Inochi Srl.",
    updated: "26 July 2026",
    icon: Scale,
    sections: [
      [
        "Operator",
        "Pagelea is operated by Inochi Srl, Via Alessandro Stradella 15, 20129 Milan, Italy; VAT IT 10196520968; REA MI 2512487; share capital €10,000. Contact: hello@pagelea.com.",
      ],
      [
        "Eligibility",
        "You must have legal capacity to accept these Terms and be at least 16 in the European Union, or the applicable minimum age where you live. If you use Pagelea for an organisation, you confirm that you are authorised to act for it.",
      ],
      [
        "Free community service",
        "The eight published manual PDF tools are free to use without hourly or daily task quotas. Transparent safety limits still apply to file size, page count, multi-file jobs and other resource-intensive input. The hosted service may evolve, experience interruptions or change compatibility without a service-level commitment.",
      ],
      [
        "Acceptable use",
        "Use Pagelea only with documents and content you are authorised to process. Do not infringe rights, break the law, bypass safeguards, distribute malware, overload the service or use it for deceptive, abusive or harmful activity.",
      ],
      [
        "Your documents and backups",
        "You retain responsibility for your documents and output. Keep an original backup and inspect every result before relying on it. Pagelea processes supported files locally but does not provide legal, compliance, archival or malware-certification advice.",
      ],
      [
        "Open-source software licence",
        "Pagelea Community source code is licensed under GNU Affero General Public License version 3 or, at your option, any later version. The repository licence governs copying, modification, network use and redistribution of the software; these website Terms do not replace or narrow rights granted by that licence.",
      ],
      [
        "Trademarks",
        "The AGPL software licence does not grant permission to use Pagelea names, logos, product dress or other Inochi SRL marks except for truthful nominative reference. The repository trademark policy governs branded forks and distribution, and you must not imply sponsorship or endorsement.",
      ],
      [
        "Enterprise, SDK and professional services",
        "Managed deployments, proprietary embedding rights, integrations and engineering support are offered only through a separate written agreement with Inochi SRL. Those services do not remove access to the eight free community tools.",
      ],
      [
        "Availability and liability",
        "Pagelea is provided with reasonable care on an as-available basis. To the maximum extent permitted by law, Inochi is not liable for indirect or consequential loss, lost profits, lost data or damage caused by relying on unchecked output. Nothing excludes liability or remedies that cannot lawfully be excluded.",
      ],
      [
        "Protecting the service",
        "Inochi may restrict abusive traffic or access when reasonably necessary to protect Pagelea, comply with law, address a security risk or respond to a material breach of these Terms.",
      ],
      [
        "Law, changes and contact",
        "Italian law governs these Terms without depriving consumers of mandatory protections or courts available in their country of residence. Material updates will be posted with a new effective date. Questions or complaints can be sent to hello@pagelea.com.",
      ],
      [
        "Independent identity",
        "Pagelea is not affiliated with, sponsored by or endorsed by Sejda BV. Its branding, product copy and design were developed independently; third-party software and icons remain subject to their respective licences.",
      ],
    ],
  },
  cookies: {
    eyebrow: "Cookies",
    title: "Fewer crumbs, cleaner browsing.",
    lead: "Pagelea does not use advertising or product-analytics cookies. Hosting infrastructure can use limited technical cookies needed to deliver and protect the site.",
    updated: "26 July 2026",
    icon: CheckCircle2,
    sections: [
      [
        "Cloudflare security",
        "The hosting edge may set the strictly necessary __cf_bm cookie to distinguish automated traffic and protect Pagelea from abuse. Cloudflare documents a lifetime of 30 minutes after continuous inactivity and states that the cookie is generated per site rather than from a Pagelea user ID.",
      ],
      [
        "No Pagelea sign-in or payment cookies",
        "The consumer PDF workspace has no registration, session or online purchase flow, so Pagelea does not set cookies for those purposes.",
      ],
      [
        "No advertising or analytics cookies",
        "Pagelea does not set cookies for advertising, behavioural profiling or product analytics. Optional anonymous product counters do not read or write identifiers on your device and remain disabled unless both privacy controls are deliberately enabled.",
      ],
      [
        "Local workspace data",
        "The PDF workspace uses browser memory and temporary object URLs rather than a persistent document library. Reloading the page clears selected documents and generated workspace state; downloaded files remain wherever you saved them.",
      ],
      [
        "Consent and control",
        "Because currently observed cookies are strictly necessary, Pagelea does not display a consent banner. You can clear or block cookies in browser settings, although hosting security controls may stop working. Pagelea will request prior consent before adding non-essential trackers where applicable law requires it.",
      ],
    ],
  },
  help: {
    eyebrow: "Help centre",
    title: "The fastest answer is usually in the workflow.",
    lead: "Pagelea keeps controls contextual and error messages specific. If something still feels unclear, these are the best places to start.",
    updated: "27 July 2026",
    icon: BookOpen,
    sections: [
      [
        "Choosing files",
        "Open any tool, drag compatible documents into the workspace, or use the file picker. Multi-file tools show reorder controls automatically.",
      ],
      [
        "Processing",
        "Choose the relevant options, then select “Process with Pagelea”. A progress state explains what is happening.",
      ],
      [
        "Downloads",
        "A completed document downloads automatically. The result panel lets you download again or reset the workspace.",
      ],
      [
        "Limits and compatibility",
        "Pagelea supports PDF, JPG and PNG in the workflows that list them. In PDF Editor, Private Rewrite recognizes English or Italian scanned text locally before you edit it. OCR and Unicode support are explicit rather than universal, and every export should be compared with the original. Resource limits protect your tab; an explicit error means the file must be reduced or processed in smaller groups.",
      ],
      [
        "Contact support",
        "Write to hello@pagelea.com with the tool name, browser, error text and reproducible steps. Avoid attaching confidential originals; use a redacted sample only when it is genuinely needed to reproduce the issue.",
      ],
    ],
  },
} as const;

const PAGE_REFERENCES: Partial<
  Record<
    keyof typeof PAGES,
    readonly (readonly [label: string, href: string])[]
  >
> = {
  about: [
    [
      "Pagelea source repository",
      "https://github.com/inochisrl/pagelea.com",
    ],
  ],
  cookies: [
    [
      "Cloudflare cookie documentation",
      "https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/",
    ],
    [
      "OpenAI cookie policy",
      "https://openai.com/policies/cookie-policy/",
    ],
    [
      "Italian DPA cookie guidance",
      "https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9677876",
    ],
  ],
  privacy: [
    [
      "ChatGPT Sites data-processing addendum",
      "https://openai.com/policies/chatgpt-sites-data-processing-addendum/",
    ],
    [
      "Italian Data Protection Authority",
      "https://www.garanteprivacy.it/",
    ],
  ],
  security: [
    [
      "Pagelea security policy",
      "https://github.com/inochisrl/pagelea.com/security/policy",
    ],
  ],
  terms: [
    [
      "GNU AGPL-3.0-or-later licence",
      "https://github.com/inochisrl/pagelea.com/blob/main/LICENSE",
    ],
    [
      "Pagelea trademark policy",
      "https://github.com/inochisrl/pagelea.com/blob/main/TRADEMARKS.md",
    ],
    [
      "ChatGPT Sites terms",
      "https://openai.com/policies/chatgpt-sites-terms/",
    ],
  ],
};

export function generateStaticParams() {
  return Object.keys(PAGES).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = PAGES[slug as keyof typeof PAGES];
  if (!page) return {};

  return {
    title: page.eyebrow,
    description: page.lead,
  };
}

export default async function InfoPage({ params }: PageProps) {
  const { slug } = await params;
  const page = PAGES[slug as keyof typeof PAGES];
  if (!page) notFound();

  const Icon = page.icon;
  const references =
    PAGE_REFERENCES[slug as keyof typeof PAGE_REFERENCES] ?? [];

  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <section className={styles.hero}>
          <div className={`${styles.heroInner} container`}>
            <span className={styles.icon}>
              <Icon size={28} />
            </span>
            <p className="eyebrow">{page.eyebrow}</p>
            <h1 className="display">{page.title}</h1>
            <p className={styles.lead}>{page.lead}</p>
            <p className={styles.updated}>Last updated {page.updated}</p>
          </div>
        </section>
        <section className={styles.content}>
          <div className={`${styles.contentInner} container`}>
            {page.sections.map(([title, copy], index) => (
              <article key={title}>
                <span className="display">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 className="display">{title}</h2>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
            {references.length > 0 ? (
              <aside className={styles.references}>
                <h2 className="display">Official references</h2>
                <p>
                  Project, provider and regulatory notices relevant to this
                  Pagelea page.
                </p>
                <ul>
                  {references.map(([label, href]) => (
                    <li key={href}>
                      <a href={href} rel="noreferrer" target="_blank">
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </aside>
            ) : null}
          </div>
        </section>
        <section className={styles.cta}>
          <div className={`${styles.ctaInner} container`}>
            <div>
              <p className="eyebrow">Ready when you are</p>
              <h2 className="display">Put a PDF in its place.</h2>
            </div>
            <Link className="button-primary" href="/#tools">
              Explore all tools <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
