import type { Metadata } from "next";
import { requireAdminIdentity } from "../../admin-auth";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import styles from "./analytics.module.css";

export const metadata: Metadata = {
  title: "Product analytics",
  description: "Private, aggregate Pagelea product analytics.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  await requireAdminIdentity();

  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <AnalyticsDashboard />
      </main>
      <SiteFooter />
    </>
  );
}
