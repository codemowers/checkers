FROM alpine:3.22 AS assets
WORKDIR /assets
# Pinned by digest: the build must not silently pick up whatever the CDN serves.
RUN wget -q -O wood-table-001.jpg https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_table_001/wood_table_001_diff_1k.jpg \
 && echo "460dd08d240f4a1f02982415048c3c5c200f385db212da18dc7e2df68bf4d0be  wood-table-001.jpg" | sha256sum -c -

FROM node:26-alpine AS base
RUN apk upgrade --no-cache
RUN npm install --global npm@12.2.0 && npm cache clean --force
ENV PORT=3001 \
    HOSTNAME=::
WORKDIR /app
# Stable assets come before dependency and source layers in every target.
COPY --from=assets /assets/ ./public/textures/

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
COPY package.json package-lock.json next.config.js next-env.d.ts tsconfig.json proxy.ts ./
COPY app ./app
COPY lib ./lib
COPY runtime ./runtime
RUN chmod -R 0755 ./runtime && chmod a+w next-env.d.ts
COPY scripts ./scripts
CMD ["node", "runtime/dev.mjs"]

FROM base AS build
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json next.config.js next-env.d.ts tsconfig.json proxy.ts ./
COPY app ./app
COPY lib ./lib
COPY runtime ./runtime
RUN chmod -R 0755 ./runtime
COPY scripts ./scripts
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY runtime ./runtime
RUN chmod -R 0755 ./runtime
CMD ["node", "runtime/server.mjs"]
