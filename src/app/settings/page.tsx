import { ko as t } from '@/copy/ko';
import { AiToggle } from '@/components/AiToggle';
import { ProjectAutoMergeToggle } from '@/components/ProjectAutoMergeToggle';
import { ProjectReconcileButton } from '@/components/ProjectReconcileButton';
import { listAutoMergeProjects } from '@/lib/projects';
import { getSettings } from '@/lib/settings';
import styles from './page.module.css';

export default async function SettingsPage() {
  const settings = getSettings();
  const autoMergeProjects = listAutoMergeProjects();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.settings.title}</h1>
        <p className={styles.subtitle}>{t.settings.subtitle}</p>
      </header>

      <section className={styles.card} aria-label={t.settings.ai.ariaLabel}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>{t.settings.ai.title}</div>
            <div className={styles.cardDesc}>{t.settings.ai.desc}</div>
          </div>
        </div>
        <AiToggle initial={settings.aiEnabled} />
        <div className={styles.cardImpact}>
          <strong>{t.settings.ai.impactTitle}</strong>
          <ul>
            <li>{t.settings.ai.impact.analyze}</li>
            <li>{t.settings.ai.impact.cluster}</li>
            <li>{t.settings.ai.impact.autoMerge}</li>
            <li>{t.settings.ai.impact.humanFlow}</li>
          </ul>
        </div>
      </section>

      <section className={styles.card} aria-label={t.settings.autoMerge.ariaLabel}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>{t.settings.autoMerge.title}</div>
            <div className={styles.cardDesc}>{t.settings.autoMerge.desc}</div>
          </div>
        </div>
        {autoMergeProjects.length === 0 ? (
          <div className={styles.cardEmpty}>{t.settings.autoMerge.empty}</div>
        ) : (
          <div className={styles.projectList}>
            {autoMergeProjects.map((row) => (
              <ProjectAutoMergeToggle key={row.id} row={row} />
            ))}
          </div>
        )}
        <div className={styles.cardHint}>{t.settings.autoMerge.hintCheckSubscription}</div>
      </section>

      {autoMergeProjects.length > 0 && (
        <section className={styles.card} aria-label={t.settings.reconcile.title}>
          <div className={styles.cardHead}>
            <div>
              <div className={styles.cardTitle}>{t.settings.reconcile.title}</div>
              <div className={styles.cardDesc}>{t.settings.reconcile.desc}</div>
            </div>
          </div>
          <div className={styles.projectList}>
            {autoMergeProjects.map((row) => (
              <div key={row.id} className={styles.projectRow}>
                <div className={styles.projectMeta}>
                  <span className={styles.projectSlug}>{row.slug}</span>
                </div>
                <ProjectReconcileButton projectId={row.id} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
