# 진행 상황

인터뷰싱크 — 후보자 희망시간·면접관 캘린더·회의실을 자동으로 대조해 면접 일정을 확정하고, 변경이 생기면 자동으로 재조율하는 채용 도구.

이 파일은 대화가 끊기거나 다른 사람(또는 다른 세션)이 이어받아도, 지금까지 뭘 했고 다음이 뭔지
파일만 보고 파악할 수 있도록 만든 진행 상황 기록이다. 코드가 곧 진실이므로, 아래 내용과 실제
코드가 다르면 코드를 따른다.

## 배포 상태

- 프로덕션: https://interview-sync-nu.vercel.app (GitHub `master` 브랜치 push 시 자동 배포)
- DB: Supabase (서비스 롤 키로만 접근, 브라우저 직접 접근 없음)
- 이메일: Gmail SMTP (개인 계정 — 실무 도입 시 AWS SES 등으로 교체 필요, 아래 "알려진 한계" 참고)

## 완료된 핵심 기능

- 후보자 희망시간 ↔ 면접관 캘린더 ↔ 회의실 자동 대조 및 확정
- 전원 동시 가능 시간이 없으면 충돌 최소 시간을 추천(동점 시 전부 제안)
- 후보자가 1~3순위 제출 → 면접관 전원에게 각 순위 참석 가능 여부 확인 요청 → 전원 가능한
  가장 높은 순위로 자동 확정(`lib/requestPriorityConfirmation.ts`, `lib/confirmFromPriorities.ts`)
- 확정 후 후보자가 일정 변경을 요청하면, 후보자에게 먼저 넓게(이번 주+다음 주) 가능한 시간을
  체크하게 하고 그 시간 전체를 면접관 전원에게 재확인시켜 자동 재확정(항상 재확인을 거치며,
  라이브 데이터만 보고 조용히 확정하지 않음 — `app/api/respond/[token]/route.ts`의
  `reschedule_request` 분기)
- 후보자가 처음 추천받은 시간을 전부 거절하면, 면접관 재문의 대신 후보자에게 다음 주 시간을
  체크하게 하고, 그래도 안 되면 자유 입력(가능 시점/사유)으로 리크루터에게 에스컬레이션
  (`candidate_wide_availability` kind, `app/interviews/page.tsx`의 대시보드 note 표시)
- 면접관 응답 진행률(N/M)을 재문의 라운드와 무관하게 정확히 계산 (`lib/interviewerProgress.ts`)
- 면접관·후보자·최종 확인 응답의 전체 히스토리(언제 무엇을 답했는지)를 스냅샷으로 저장해
  상세 페이지에서 열람 가능 (`answered_slots`/`answered_busy_slots`/`answered_preferred_slots`)
- 확정된 시간 자체는 매칭 로직상 항상 전원 가능이 보장되므로, 라이브 busy_slots로 재검증하지
  않고 매트릭스에 그대로 표시(자기참조 오류 수정)
- 미응답 자동 독촉 메일 + 면접 전날 리마인더 (Vercel Cron, `vercel.json`)
- 30분 단위 슬롯 그리드(when2meet 방식) UI, 히트맵 기반 수동 확정
- **리스크 관리 3종 세트** (`lib/email.ts`, `lib/confirmFromPriorities.ts`):
  - 킬 스위치 — `EMAIL_SENDING_ENABLED=false`면 코드 배포 없이 전체 자동 발송을 즉시 중단
  - 확정 메일 승인 게이트 통일 — 우선순위 자동 확정(`confirmFromPriorities`)도 매칭만 자동으로
    하고, 실제 확정 메일은 다른 경로와 동일하게 리크루터가 "확정 메일 발송" 버튼을 눌러야 나감
    (가장 위험한 메일에는 항상 사람 확인이 들어가도록 통일)
  - 발송 실패 가시화 — `sendEmail` 실패 시 `[email-failed]` 태그로 Vercel Logs에 남고, 이메일을
    보내는 모든 함수(확정 메일·후보자 초대·면접관 초대·재문의·최종 확인 요청)에서 실패하면
    `interview.note`에도 남아 대시보드에 바로 보임(escalated가 아니어도 note가 있으면 표시하되,
    "⚠️"가 붙거나 escalated일 때만 빨간색으로 강조). 실패한 면접관에게는 상세 페이지에서
    **"재발송"** 버튼으로 이 케이스에 정확히 연결된 새 링크를 바로 다시 보낼 수 있다
    (`app/api/interviews/[id]/reinvite-interviewer`) — 면접관 관리 페이지의 기존 "문의 메일
    보내기"는 특정 케이스와 연결되지 않은 별도 링크라 재시도 용도로는 안 맞았다.

## 알려진 한계 (실무 도입 전 반드시 해결해야 함)

- **인증이 전혀 없음** — 대시보드 URL을 아는 사람은 누구나 모든 후보자 개인정보를 보고 케이스를
  삭제할 수 있다. 포트폴리오 데모 용도로는 문제없지만(가짜 데이터만 사용), 실제 채용 데이터를
  다루려면 Supabase Auth 등으로 로그인·권한 분리부터 붙여야 한다.
- **이메일이 개인 Gmail SMTP** — 발송량 제한(일 500건), 발신 신뢰도, 계정 정지 시 전체 장애
  위험이 있다. 실무 도입 시 AWS SES 등 정식 트랜잭셔널 이메일 서비스로 교체 필요.
- 노쇼 처리·후속조치, 평가표 제출 추적·리마인드 미구현 (스코프에서 의도적으로 제외)
- 실제 구글/아웃룩 캘린더 연동 없음 — 면접관이 수동으로 그리드에 체크하는 방식. 이 프로젝트의
  핵심 가치(반복 업무 제거)를 가장 크게 끌어올릴 수 있는 확장이지만, OAuth 연동 등 별도로
  하루 이상 걸리는 작업이라 의도적으로 미룸.

## 비상시 대응 방법 (앱이 갑자기 작동 안 될 때)

Vercel(앱)과 Supabase(데이터)는 완전히 별개의 서비스라, 앱이 죽어도 데이터 자체는
그대로 살아있다. 문제 유형별로 봐야 하는 곳이 다르다:

- **사이트 자체가 안 열림** → Vercel 대시보드 → Deployments 탭에서 최근 배포가
  Error인지 확인. 문제라면 **Instant Rollback**으로 직전 정상 버전으로 즉시 복구
  (데이터는 그대로 두고 코드만 되돌리는 것이라 가장 빠르고 안전함). 단, 그 배포에
  DB 스키마 변경(마이그레이션)이 같이 있었다면 롤백해도 스키마 불일치가 남을 수
  있으니 확인 필요.
- **후보자/면접관이 표시한 시간을 지금 당장 확인해야 함** → Supabase 대시보드
  (supabase.com/dashboard) → Table Editor → `interviews`/`interviewers` 테이블에서
  직접 조회 가능(앱 상태와 무관하게 항상 열려있음). 시간은 UTC로 저장되므로
  **+9시간 하면 한국 시간**. 원본 컬럼(`busy_slots`, `preferred_slots` 등)이 읽기
  어려우면 그대로 복사해서 Claude에게 붙여넣으면 바로 가독성 있게 정리해준다.
- **채용담당자(개발자 본인이 아닌 사람)가 위 상황에서 직접 확인해야 하는 경우** →
  현재는 Supabase 로그인 권한이 없어 불가능. 계정 비밀번호를 공유하지 말고,
  Supabase의 팀원 초대 기능으로 **읽기 전용 권한**을 별도로 부여할 것(아직 미설정 —
  1인 운영 중이라 필요 시 설정).

## 다음 단계 (우선순위 순)

1. 후보자 초대 메일도 실패 시 "재발송" 버튼 추가(지금은 면접관만 케이스 연결 재발송 지원)
2. Supabase에 `interviewers_readable`, `response_requests_readable` 뷰 추가(선택 — 개발자
   본인의 디버깅 편의용, 포트폴리오 완성도와는 무관)
3. (실무 도입 시) Supabase Auth 붙이기, Gmail → AWS SES 전환

## 검증 방법

```bash
npm run lint        # ESLint
npx tsc --noEmit     # 타입 체크
npm test             # Vitest — lib/matching.ts, lib/interviewerProgress.ts, lib/slots.ts,
                     # lib/status.ts, lib/busySlots.ts에 대한 단위 테스트

# 아래는 로컬 dev 서버 + 실제 Supabase가 필요한 수동 통합 검증 (scripts/README.md 참고)
node scripts/verify-reschedule-flow.js
node scripts/verify-wide-availability-flow.js
```

핵심 매칭·확정 로직, 진행률 계산, 상태 파생 로직은 단위 테스트로 커버된다. 여러 API
라우트와 Supabase를 오가는 전체 흐름(재조율, 다음 주 가용성 체크 → 에스컬레이션)은
`scripts/`의 통합 검증 스크립트로 커버된다 — CI에서 자동으로 돌진 않지만, 저장소 안에
재현 가능한 코드로 존재한다.
