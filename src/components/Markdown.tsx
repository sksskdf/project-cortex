'use client';

// PR description 등 GitHub 마크다운 텍스트 렌더. GFM (체크박스·테이블·자동 링크)
// 지원을 위해 remark-gfm 적용. 외부 링크는 새 탭 + rel='noopener' 로 강제.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Markdown.module.css';

export function Markdown({ children }: { children: string }) {
  return (
    <div className={styles.root}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {linkChildren}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
