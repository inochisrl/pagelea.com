"use client";

import {
  ArrowRight,
  ChevronDown,
  Menu,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TOOLS, type ToolCategory } from "../lib/tools";
import { ToolIcon } from "./ToolIcon";
import styles from "./SiteHeader.module.css";

const QUICK_LINKS = [
  ["Optimize", "compress-pdf"],
  ["Edit", "pdf-editor"],
  ["Sign", "sign-pdf"],
  ["Merge", "merge-pdf"],
  ["Split", "split-pdf"],
  ["Images to PDF", "jpg-to-pdf"],
] as const;

const CATEGORY_ORDER = [
  "Merge",
  "Split",
  "Edit & Sign",
  "Optimize",
  "Security",
  "Convert to PDF",
] as const satisfies readonly ToolCategory[];

export function SiteHeader() {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");

  const groupedTools = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    const filtered = lowered
      ? TOOLS.filter((tool) =>
          `${tool.title} ${tool.description} ${tool.category}`
            .toLowerCase()
            .includes(lowered),
        )
      : TOOLS;

    return CATEGORY_ORDER.map((category) => ({
      category,
      tools: filtered.filter((tool) => tool.category === category),
    })).filter((group) => group.tools.length);
  }, [query]);

  function closeMenus() {
    setToolsOpen(false);
    setMobileOpen(false);
    setQuery("");
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={`${styles.inner} container`}>
          <Link
            aria-label="Pagelea home"
            className={styles.brand}
            href="/"
            onClick={closeMenus}
          >
            <span className={styles.brandMark} aria-hidden="true">
              P
            </span>
            <span className={`${styles.wordmark} display`}>Pagelea</span>
          </Link>

          <nav className={styles.desktopNav} aria-label="Main navigation">
            <button
              className={`${styles.navItem} ${toolsOpen ? styles.active : ""}`}
              type="button"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((open) => !open)}
            >
              All tools <ChevronDown size={15} />
            </button>
            {QUICK_LINKS.map(([label, slug], index) => (
              <Link
                className={`${styles.navItem} ${styles[`quick${index}`] ?? ""}`}
                href={`/tools/${slug}`}
                key={slug}
              >
                {label}
              </Link>
            ))}
          </nav>

          <nav className={styles.actionNav} aria-label="Project navigation">
            <Link href="/pricing">Free forever</Link>
            <a href="https://github.com/inochisrl/pagelea.com">
              Open source
            </a>
            <button
              className={`${styles.iconButton} ${styles.menuButton}`}
              type="button"
              aria-expanded={mobileOpen}
              aria-label="Open navigation"
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
          </nav>
        </div>

        {mobileOpen ? (
          <div className={styles.mobilePanel}>
            <Link href="/pricing" onClick={closeMenus}>
              Free forever
            </Link>
            <a
              href="https://github.com/inochisrl/pagelea.com"
              onClick={closeMenus}
            >
              Open source
            </a>
            <button
              type="button"
              onClick={() => {
                setToolsOpen(true);
                setMobileOpen(false);
              }}
            >
              Explore all tools <ArrowRight size={17} />
            </button>
          </div>
        ) : null}
      </header>

      {toolsOpen ? (
        <div className={styles.overlay} data-menu-open="true">
          <button
            className={styles.backdrop}
            type="button"
            aria-label="Close tools menu"
            onClick={closeMenus}
          />
          <section
            className={styles.megaMenu}
            aria-label="All PDF tools"
            aria-modal="true"
            role="dialog"
          >
            <div className={`${styles.megaInner} container`}>
              <div className={styles.megaTop}>
                <div>
                  <p className="eyebrow">Your PDF workbench</p>
                  <h2 className="display">Find the right PDF tool.</h2>
                </div>
                <label className={styles.search}>
                  <Search size={18} aria-hidden="true" />
                  <span className="sr-only">Search tools</span>
                  <input
                    autoFocus
                    value={query}
                    placeholder="Search 8 production tools…"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <button
                  className={styles.closeButton}
                  type="button"
                  aria-label="Close tools menu"
                  onClick={closeMenus}
                >
                  <X size={22} />
                </button>
              </div>

              {groupedTools.length ? (
                <div className={styles.megaGrid}>
                  {groupedTools.map((group) => (
                    <div className={styles.megaGroup} key={group.category}>
                      <h3>{group.category}</h3>
                      <div>
                        {group.tools.map((tool) => (
                          <Link
                            href={`/tools/${tool.slug}`}
                            key={tool.slug}
                            onClick={closeMenus}
                          >
                            <span
                              className={styles.miniIcon}
                              style={{ "--tool-accent": tool.accent } as React.CSSProperties}
                            >
                              <ToolIcon name={tool.icon} size={16} />
                            </span>
                            <span>{tool.title}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptySearch}>
                  <Search size={26} />
                  <p>No tool found for “{query}”.</p>
                  <span>Try “merge”, “sign” or “convert”.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
