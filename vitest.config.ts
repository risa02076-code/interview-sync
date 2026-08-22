import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * tsconfig의 "@/*" 경로 별칭을 테스트에서도 쓸 수 있게 한다.
 *
 * 이 설정이 없으면 app/ 아래 코드가 "@/lib/..."을 임포트하는 순간 그 테스트 파일이
 * 통째로 로드에 실패한다 — 개별 테스트가 실패하는 게 아니라 "0 test"로 조용히
 * 건너뛰어지므로, 통과 개수만 보면 검증된 것처럼 보인다.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
