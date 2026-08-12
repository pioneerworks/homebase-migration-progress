import type { ProjectConfig } from "./types";

export const MIGRATED_SITE_ORIGIN =
  "https://marketing-site-payload.vercel.app";

export const PILLAR_PROJECTS: ProjectConfig[] = [
  {
    id: "56f8421b-82e7-43c9-bc92-2c6bb579f0c2",
    key: "product",
    name: "Product/content families",
    shortName: "Product/content",
    url: "https://linear.app/joinhomebase/project/pillar-migration-productcontent-families-and-page-instances-7e51147c520e",
  },
  {
    id: "4598b5ea-4e7b-4bdd-ad35-935d075d5b49",
    key: "seo",
    name: "Repeatable SEO, static & industry",
    shortName: "SEO/static/industry",
    url: "https://linear.app/joinhomebase/project/pillar-migration-repeatable-seo-static-and-industry-pages-7bae9c141320",
  },
  {
    id: "ec23ecc7-6eb4-475f-8006-28535e6ce7f1",
    key: "blog",
    name: "Blog CMS & hub",
    shortName: "Blog CMS",
    url: "https://linear.app/joinhomebase/project/pillar-migration-blog-cms-and-blog-hub-53fd111931ba",
  },
  {
    id: "48b1e4f1-c7cc-4073-9ebc-b8b1adcd2d99",
    key: "foundations",
    name: "Noindex, foundations & special cases",
    shortName: "Foundations/special cases",
    url: "https://linear.app/joinhomebase/project/pillar-migration-noindex-foundations-and-special-cases-af82d50959a7",
  },
];

export const DECISIONS_PROJECT: ProjectConfig = {
  id: "7d651fee-d6cc-4b3f-bfbd-ab44c3e1e955",
  key: "decisions",
  name: "Migration decisions & learnings",
  shortName: "Decisions & learnings",
  url: "https://linear.app/joinhomebase/project/migration-decisions-learnings-f672cd82c870/issues?layout=list&ordering=priority&grouping=workflowState&subGrouping=none&showCompletedIssues=all&showSubIssues=true&showTriageIssues=true",
};

export const HOSTING_PROJECT: ProjectConfig = {
  id: "d98d04b1-af0a-4657-a74b-66aad9c010bf",
  key: "hosting",
  name: "Hosting Migration — Webflow to Vercel",
  shortName: "Hosting cutover",
  url: "https://linear.app/joinhomebase/project/hosting-migration-webflow-to-vercel-9a1247e7f6e6/overview",
};

export const SNAPSHOT_TAG = "linear-migration-snapshot";
