FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

FROM base AS deps
WORKDIR /app

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --no-frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY . .

RUN pnpm build

FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
ENV DATA_DIR=/data

COPY apps/server/package.json ./package.json
RUN pnpm install --prod --no-frozen-lockfile

COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY .env.example ./env.example

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser \
  && mkdir -p /data \
  && chown -R appuser:appuser /app /data

USER appuser

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch(`http://127.0.0.1:${process.env.PORT||4000}/health/ready`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
