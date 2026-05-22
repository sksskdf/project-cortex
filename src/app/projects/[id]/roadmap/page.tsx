// Phase 10 — /projects/[id]/roadmap 페이지. 프로젝트의 Phase·산출물 보드.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ko as t } from '@/copy/ko';
import { RoadmapBoard } from '@/components/RoadmapBoard';
import { getProjectRoadmap } from '@/lib/roadmap';
import styles from './page.module.css';

export default async function ProjectRoadmapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isFinite(projectId)) notFound();

  const view = getProjectRoadmap(projectId);
  if (!view) notFound();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/projects" className={styles.back}>
          {t.roadmap.backToProject}
        </Link>
        <div className={styles.titleRow}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>
              {t.roadmap.title} · {view.projectSlug}
            </h1>
            <p className={styles.subtitle}>{t.roadmap.subtitle(view.projectSlug)}</p>
          </div>
          <div className={styles.overall}>
            <span className={styles.overallLabel}>
              {t.roadmap.overallProgress(view.overallPct)}
            </span>
            <span className={styles.overallBar} aria-hidden>
              <span className={styles.overallBarFill} style={{ width: `${view.overallPct}%` }} />
            </span>
          </div>
        </div>
      </header>

      <RoadmapBoard view={view} />
    </div>
  );
}
