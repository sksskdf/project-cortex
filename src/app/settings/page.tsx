import { ko as t } from '@/copy/ko';
import { AiToggle } from '@/components/AiToggle';
import { ProjectAutoMergeToggle } from '@/components/ProjectAutoMergeToggle';
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
      </section>
    </div>
  );
}
