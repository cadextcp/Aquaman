# syntax=docker/dockerfile:1

########## deps ##########
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

########## build ##########
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# standalone output + native externals are set in next.config.ts
# AQUAMAN_DATA_DIR must NOT be ./data during build (no db writes at build time)
RUN npm run build

########## runner ##########
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    AQUAMAN_DATA_DIR=/app/data \
    AQUAMAN_TIMEZONE=Europe/Berlin \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# native modules must match runner arch — same base as build stage
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
# migrate.ts imports ../src/lib/db — the standalone trace does not include
# non-route source files, so scripts/migrate.ts cannot resolve it without this
COPY --from=build /app/src ./src
# tsx needs this to resolve the "@/*" path alias (get-tsconfig reads it) —
# without it, any "@/..." import reachable from migrate.ts's dependency graph
# (e.g. db/schema.ts importing @/lib/domain/action-types) 500s at boot with
# MODULE_NOT_FOUND, even though the file exists on disk.
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
COPY --from=build /app/node_modules/.bin ./node_modules/.bin
# tsx deps (esbuild etc.) — copy the few packages tsx needs at runtime
COPY --from=build /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=build /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=build /app/node_modules/@esbuild ./node_modules/@esbuild
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /app/data \
    # non-root runtime (issue #14): app only needs /app/data + a port
    && chown -R node:node /app/data /app/.next

USER node

EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# migrate on boot, then start standalone server
# NOTE: standalone output is copied to /app directly (not /app/.next/standalone) —
# the server entrypoint therefore lives at ./server.js, not .next/standalone/server.js
CMD ["node", "-e", "const{spawn}=require('child_process');const m=spawn('node_modules/.bin/tsx',['scripts/migrate.ts'],{stdio:'inherit'});m.on('exit',c=>{if(c!==0)process.exit(c);require('./server.js')})"]
