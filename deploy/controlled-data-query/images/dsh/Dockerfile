FROM node:24.7.0-bookworm-slim AS build

ARG PNPM_VERSION=11.7.0
ARG DSH_CLIENT_COMMIT_HASH
WORKDIR /workspace
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN test -n "${DSH_CLIENT_COMMIT_HASH}" && pnpm run build
RUN pnpm --filter dsh-data-aid-runtime deploy --legacy --prod \
      --config.node-linker=hoisted \
      --config.auto-install-peers=false \
      --config.link-workspace-packages=true \
      --config.allow-unused-patches=true \
      /runtime \
    && node deploy/controlled-data-query/images/dsh/prepare-runtime.mjs /runtime \
    && test -f /runtime/apps/cli/lib/bin.js \
    && test -z "$(find /runtime/node_modules/@deepseek-ai -type d \( -name src -o -name test -o -name tests -o -name __tests__ \) -print -quit)" \
    && test -z "$(find /runtime/node_modules -type d \( -name test -o -name tests -o -name __tests__ \) -print -quit)" \
    && test -z "$(find /runtime/node_modules -type l -print -quit)" \
    && node --expose-internals /runtime/apps/cli/lib/bin.js --profile data-aid --dump-config > /dev/null

FROM node:24.7.0-bookworm-slim
ENV NODE_ENV=production \
    HOME=/home/dsh
WORKDIR /runtime
COPY --from=build --chown=10001:10001 /runtime /runtime
RUN install -d -o 10001 -g 10001 /home/dsh
USER 10001:10001
RUN node --expose-internals apps/cli/lib/bin.js --profile data-aid --dump-config > /dev/null \
    && rm -rf /home/dsh/.dsh
EXPOSE 3081
CMD ["node", "--expose-internals", "apps/cli/lib/bin.js", "--profile", "data-aid"]
