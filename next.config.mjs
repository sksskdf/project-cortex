/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sentry(@sentry/node) 의 OpenTelemetry 트레이싱 통합이 끌어오는
  // @opentelemetry/instrumentation · @prisma/instrumentation 은 런타임에
  // 동적 require 를 쓰기 때문에 webpack 번들 대상이 되면
  // "Critical dependency: the request of a dependency is an expression"
  // 경고가 발생한다. 서버 외부 패키지로 지정해 번들에서 제외하면
  // 경고가 사라지고 Node 가 직접 require 하므로 Sentry 기능도 그대로 동작한다.
  serverExternalPackages: [
    '@sentry/nextjs',
    '@sentry/node',
    '@opentelemetry/instrumentation',
    '@prisma/instrumentation',
  ],
};

export default nextConfig;
