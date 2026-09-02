FROM node:20-alpine as build

WORKDIR /app

# Set environment variable to skip Puppeteer download (for ARM compatibility)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the application - build both frontend and backend
RUN npm run build

# Production image
FROM node:20-alpine as production

# Install PostgreSQL client for database initialization
RUN apk add --no-cache postgresql-client netcat-openbsd

WORKDIR /app

# Set environment variable to skip Puppeteer download (for ARM compatibility)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies including tsx for running TypeScript scripts
RUN npm ci --omit=dev
# Install tsx and TypeScript for running migration scripts
RUN npm install --save-dev tsx typescript
# Install PostgreSQL client and database dependencies
RUN npm install pg drizzle-orm zod
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
# Required so tsx (used to run scripts/migrate.ts and init-data.ts as raw
# TypeScript) can resolve the @shared/* path alias. Without this,
# `@shared/schema` fails with ERR_MODULE_NOT_FOUND. dist/index.js itself
# doesn't need this: esbuild already resolved the alias at build time when
# bundling it.
COPY --from=build /app/tsconfig.json ./tsconfig.json
# The migration runner, the generated SQL migrations it applies, and the frozen
# legacy chain it uses to catch an older database up before baselining it.
# Only migrate.ts: the other scripts are development tools and pull in
# devDependencies this image does not install.
COPY --from=build /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/init-data.ts ./init-data.ts

# Kopiere das Entrypoint-Skript
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Umgebungsvariablen
ENV NODE_ENV=production
ENV PORT=8080

# Verwende das Entrypoint-Skript als Startpunkt
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

# Stelle sicher, dass der Container auf Port 8080 hört
EXPOSE 8080
