import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { fixturePRDetail, type PRDetailFixture } from '@/fixtures/pr-detail';
import { flagsToTags, formatRelativeAge, gaugeTierFromConfidence, reasonTone } from '@/lib/format';
import type { PR, ReasonTone } from '@/lib/types';

export type PRDetailView = {
  pr: PR;
  fixture: PRDetailFixture;
  hunkSummary: {
    totalHunks: number;
    autoApprovableHunks: number;
    filesChanged: number;
    additions: number;
    deletions: number;
  };
};

function parsePrId(viewId: string): number | null {
  const match = viewId.match(/^pr-(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

export async function getPRDetail(viewId: string): Promise<PRDetailView | null> {
  const dbId = parsePrId(viewId);
  if (dbId === null) return null;

  const row = db
    .select({
      pr: prs,
      preReview: preReviews,
      triage: triageDecisions,
      repoSlug: projects.slug,
    })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    .leftJoin(preReviews, eq(preReviews.prId, prs.id))
    .leftJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(eq(prs.id, dbId))
    .get();

  if (!row) return null;

  const confidence = row.preReview?.confidence ?? 0;
  const flags = row.preReview?.flags ?? [];
  const tone: ReasonTone = row.triage ? reasonTone(confidence, flags) : 'info';
  const createdAtMs =
    row.pr.createdAt instanceof Date ? row.pr.createdAt.getTime() : Number(row.pr.createdAt) * 1000;

  const pr: PR = {
    id: viewId,
    title: row.pr.title,
    repo: row.repoSlug,
    number: row.pr.number,
    author: { name: row.pr.authorId, kind: row.pr.authorKind },
    tags: flagsToTags(flags),
    reason: { text: row.triage?.reason ?? '', tone },
    additions: row.pr.linesAdded,
    deletions: row.pr.linesRemoved,
    fileCount: row.pr.filesChanged,
    ageText: formatRelativeAge(createdAtMs),
    gauge: { value: confidence, tier: gaugeTierFromConfidence(confidence) },
  };

  return {
    pr,
    fixture: fixturePRDetail,
    hunkSummary: {
      totalHunks: fixturePRDetail.hunkSummary.totalHunks,
      autoApprovableHunks: fixturePRDetail.hunkSummary.autoApprovableHunks,
      filesChanged: row.pr.filesChanged,
      additions: row.pr.linesAdded,
      deletions: row.pr.linesRemoved,
    },
  };
}
