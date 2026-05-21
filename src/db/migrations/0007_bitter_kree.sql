ALTER TABLE `prs` ADD `tests_passed` integer;
--> statement-breakpoint
-- 기존 preReviews 의 최신 SHA testsPassed 값을 prs 로 복사 — AI 분석과 무관하게 PR
-- 의 CI 결과를 유지 (PR.headSha 와 매칭되는 preReview 1건만 — leftJoin 동일 룰).
UPDATE prs
SET tests_passed = (
  SELECT pr.tests_passed
  FROM pre_reviews pr
  WHERE pr.pr_id = prs.id
    AND pr.head_sha = prs.head_sha
    AND pr.tests_passed IS NOT NULL
  ORDER BY pr.analyzed_at DESC
  LIMIT 1
)
WHERE tests_passed IS NULL;
