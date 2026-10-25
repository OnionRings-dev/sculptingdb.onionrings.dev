# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4 AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun --bun run build

FROM dependencies AS migration-build
COPY scripts/migrate.ts ./scripts/migrate.ts
RUN bun build scripts/migrate.ts --target=bun --external=pg-native --outdir=/migration

FROM oven/bun:1.4.4-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
USER bun
ENTRYPOINT ["docker-entrypoint"]

FROM runtime AS migrate
COPY --from=migration-build /migration/migrate.js ./scripts/migrate.js
COPY drizzle ./drizzle
CMD ["bun", "scripts/migrate.js"]

FROM runtime AS app
ENV HOST=0.0.0.0 PORT=3000
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
