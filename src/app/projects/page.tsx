// Phase 8 — /projects 페이지. 사이드바 "프로젝트" 활성화.
// Phase 10.1 후속 — Gauge 제거, 컴팩트 카드 + 로드맵 drawer 통합.

import { ko as t } from '@/copy/ko';
import { ProjectsList, type ProjectCardData } from '@/components/ProjectsList';
import { listProjectsWithStats } from '@/lib/projects';
import { getProjectRoadmap } from '@/lib/roadmap';
import { getWorkspace } from '@/lib/workspace';
import styles from './page.module.css';

export default async function ProjectsPage() {
  const rows = listProjectsWithStats();
  const active = rows.filter((r) => r.installationId !== null);
  const seed = rows.filter((r) => r.installationId === null);

  // 카드별 로드맵 + 워크스페이스 prep — drawer 가 클릭 즉시 보여주도록 미리 fetch.
  const activeCards: ProjectCardData[] = active.map((row) => ({
    row,
    roadmap: getProjectRoadmap(row.id),
    workspace: getWorkspace(row.id),
  }));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.projects.title}</h1>
        <p className={styles.subtitle}>{t.projects.subtitle}</p>
      </header>

      {active.length === 0 && seed.length === 0 ? (
        <div className={styles.empty}>
          <strong>{t.projects.empty.title}</strong>
          <p>{t.projects.empty.desc}</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t.projects.section.active}</h2>
              <ProjectsList cards={activeCards} />
            </section>
          )}

          {seed.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t.projects.section.seed}</h2>
              <p className={styles.sectionDesc}>{t.projects.section.seedDesc}</p>
              <div className={styles.seedList}>
                {seed.map((row) => (
                  <div key={row.id} className={styles.seedItem}>
                    <span className={styles.cardSlug}>{row.slug}</span>
                    <span className={styles.seedBadge}>{t.projects.seedBadge}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
