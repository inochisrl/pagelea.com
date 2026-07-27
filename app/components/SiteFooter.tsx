import Link from "next/link";
import { ArrowUpRight, Heart } from "lucide-react";
import { TOOLS } from "../lib/tools";
import styles from "./SiteFooter.module.css";

const DEPLOYED_VERSION = "v0.4.2";
const DEPLOYED_SOURCE_URL =
  `https://github.com/inochisrl/pagelea.com/tree/${DEPLOYED_VERSION}`;

const RESOURCE_LINKS = [
  ["Free forever", "/pricing"],
  [`Source for ${DEPLOYED_VERSION}`, DEPLOYED_SOURCE_URL],
  ["About Pagelea", "/about"],
  ["Help centre", "/help"],
  ["Security", "/security"],
];

const LEGAL_LINKS = [
  ["Terms of use", "/terms"],
  ["Privacy policy", "/privacy"],
  ["Cookies", "/cookies"],
  ["Security", "/security"],
];

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`${styles.inner} container`}>
        <div className={styles.brandColumn}>
          <Link className={styles.brand} href="/">
            <span aria-hidden="true">P</span>
            <strong className="display">Pagelea</strong>
          </Link>
          <p>
            Small, focused PDF tools that respect your time and keep your files
            close.
          </p>
          <a className={styles.contact} href="mailto:hello@pagelea.com">
            hello@pagelea.com <ArrowUpRight size={15} />
          </a>
          <small>
            Free and open-source software, crafted with care in Europe.{" "}
            <Heart aria-hidden="true" size={12} fill="currentColor" />
          </small>
        </div>

        <div className={styles.linkColumn}>
          <h2>Resources</h2>
          {RESOURCE_LINKS.map(([label, href]) => (
            href.startsWith("https://") ? (
              <a href={href} key={href}>
                {label}
              </a>
            ) : (
              <Link href={href} key={href}>
                {label}
              </Link>
            )
          ))}
          <h2 className={styles.secondaryHeading}>Legal</h2>
          {LEGAL_LINKS.map(([label, href]) => (
            <Link href={href} key={href}>
              {label}
            </Link>
          ))}
        </div>

        <div className={styles.toolsColumn}>
          <h2>PDF tools</h2>
          <div>
            {TOOLS.map((tool) => (
              <Link href={`/tools/${tool.slug}`} key={tool.slug}>
                {tool.title}
              </Link>
            ))}
          </div>
        </div>

        <div className={styles.languageColumn}>
          <h2>Language</h2>
          <span className={styles.languagePill}>English · EN</span>
          <p>The public beta interface is currently available in English.</p>
          <div className={styles.status}>
            <span />
            Public beta tools available
          </div>
        </div>
      </div>
      <div className={`${styles.bottom} container`}>
        <span>© {new Date().getFullYear()} Inochi SRL</span>
        <span>
          <a href={DEPLOYED_SOURCE_URL}>Source for {DEPLOYED_VERSION}</a>
          {" · "}AGPL-3.0-or-later software. Pagelea is an Inochi SRL trademark.
        </span>
      </div>
    </footer>
  );
}
