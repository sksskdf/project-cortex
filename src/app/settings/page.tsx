import { ko as t } from '@/copy/ko';
import { AiToggle } from '@/components/AiToggle';
import { InstallCortexSkillButton } from '@/components/InstallCortexSkillButton';
import { getSettings } from '@/lib/settings';
import styles from './page.module.css';

export default async function SettingsPage() {
  const settings = getSettings();

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

      <section className={styles.card} aria-label={t.settings.skill.title}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>{t.settings.skill.title}</div>
            <div className={styles.cardDesc}>{t.settings.skill.desc}</div>
          </div>
        </div>
        <InstallCortexSkillButton />
      </section>
    </div>
  );
}
