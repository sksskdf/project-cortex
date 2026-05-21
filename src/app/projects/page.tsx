// Phase 8 — /projects 페이지. 사이드바 "프로젝트" 활성화.
// 등록된 프로젝트 (레포) 목록 + 통계 (활성 PR / 머지 누적 / 평균 신뢰).
// 자동 머지 토글 + GitHub 와 동기화 버튼도 같이 — /settings 에 분산돼 있던 것들을
// 프로젝트 중심 뷰로 모음.

import { ko as t } from '@/copy/ko';
import { Gauge } from '@/components/Gauge';
import { ProjectAutoMergeToggle } from '@/components/ProjectAutoMergeToggle';
import { ProjectReconcileButton } from '@/components/ProjectReconcileButton';
import { gaugeTierFromConfidence } from '@/lib/format';
import { listProjectsWithStats } from '@/lib/projects';
import styles from './page.module.css';

export default async function ProjectsPage() {
  const rows = listProjectsWithStats();
  const active = rows.filter((r) => r.installationId !== null);
  const seed = rows.filter((r) => r.installationId === null);

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
              <div className={styles.list}>
                {active.map((row) => (
                  <article key={row.id} className={styles.card}>
                    <header className={styles.cardHead}>
                      <div className={styles.cardMeta}>
                        <span className={styles.cardSlug}>{row.slug}</span>
                        <span className={styles.cardName}>{row.name}</span>
                      </div>
                      <Gauge
                        value={row.avgConfidence}
                        tier={gaugeTierFromConfidence(row.avgConfidence)}
                      />
                    </header>
                    <div className={styles.cardStats}>
                      <div className={styles.statBlock}>
                        <span className={styles.statLabel}>{t.projects.stat.active}</span>
                        <span className={styles.statValue}>{row.activePRs}</span>
                      </div>
                      <div className={styles.statBlock}>
                        <span className={styles.statLabel}>{t.projects.stat.merged}</span>
                        <span className={styles.statValue}>{row.mergedPRs}</span>
                      </div>
                      <div className={styles.statBlock}>
                        <span className={styles.statLabel}>{t.projects.stat.avgConfidence}</span>
                        <span className={styles.statValue}>{row.avgConfidence || '-'}</span>
                      </div>
                    </div>
                    <div className={styles.cardActions}>
                      <div className={styles.cardActionRow}>
                        <span className={styles.cardActionLabel}>
                          {t.projects.action.autoMerge}
                        </span>
                        <ProjectAutoMergeToggle row={row} />
                      </div>
                      <div className={styles.cardActionRow}>
                        <span className={styles.cardActionLabel}>{t.projects.action.sync}</span>
                        <ProjectReconcileButton projectId={row.id} />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
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
