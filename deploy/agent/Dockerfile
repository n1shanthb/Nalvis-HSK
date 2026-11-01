# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global pnpm@9.15.9 --ignore-scripts
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY packages ./packages
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    pnpm install --frozen-lockfile --filter @nalvis/keeper --filter @nalvis/core && pnpm --filter @nalvis/keeper build
FROM node:22-bookworm-slim
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global pnpm@9.15.9 --ignore-scripts
WORKDIR /app
COPY --from=build /app /app
COPY policy ./policy
COPY docs/ADDRESSES.md ./docs/ADDRESSES.md
COPY contracts/deployments ./contracts/deployments
ENV NODE_ENV=production AGENT_DATA_DIR=/data
EXPOSE 8787
CMD ["node", "packages/keeper/dist/keeper/src/cli.js", "agent", "--exec", "testnet"]
