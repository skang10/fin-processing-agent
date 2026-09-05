FROM node:22.19.0-bookworm-slim AS build

RUN npm install --global pnpm@11.3.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @findoc/web build

FROM node:22.19.0-bookworm-slim AS runtime

ENV NODE_ENV=production
RUN npm install --global pnpm@11.3.0
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
