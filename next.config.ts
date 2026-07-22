import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /interviews/* 는 전부 클라이언트에서 fetch로 데이터를 받아오는 화면이라
  // cacheComponents(PPR 강제 캐시 경계 검사)와 맞지 않아 비활성화한다.
  cacheComponents: false,
};

export default nextConfig;
