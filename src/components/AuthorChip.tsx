import type { PRAuthor } from '@/lib/types';
import { AgentFaceIcon, HumanFaceIcon } from './icons';
import styles from './AuthorChip.module.css';

export function AuthorChip({ author, suffix }: { author: PRAuthor; suffix?: string }) {
  const isAgent = author.kind === 'agent';
  return (
    <span className={`${styles.chip} ${isAgent ? styles.agent : styles.human}`}>
      {isAgent ? <AgentFaceIcon /> : <HumanFaceIcon />}
      {suffix ? `${author.name}${suffix}` : author.name}
    </span>
  );
}
