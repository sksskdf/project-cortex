import type { PRAuthor } from '@/lib/types';
import styles from './AuthorChip.module.css';

function agentFaceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x={4} y={4} width={16} height={16} rx={2} />
      <circle cx={9} cy={10} r={1.5} fill="currentColor" />
      <circle cx={15} cy={10} r={1.5} fill="currentColor" />
      <path d="M9 15h6" />
    </svg>
  );
}

function humanFaceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx={12} cy={7} r={4} />
    </svg>
  );
}

export function AuthorChip({ author, suffix }: { author: PRAuthor; suffix?: string }) {
  const isAgent = author.kind === 'agent';
  return (
    <span className={`${styles.chip} ${isAgent ? styles.agent : styles.human}`}>
      {isAgent ? agentFaceIcon() : humanFaceIcon()}
      {suffix ? `${author.name}${suffix}` : author.name}
    </span>
  );
}
