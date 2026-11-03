# -------------------------------------------------------------
# Stage 1: Build stage (compile TypeScript & generate Prisma)
# -------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install openssl required by Prisma on Alpine Linux
RUN apk add --no-cache openssl

# Copy package manifests
COPY package*.json ./

# Install all dependencies (including devDependencies like typescript)
RUN npm ci

# Copy Prisma schema
COPY prisma ./prisma/

# Generate Prisma Client (with linux-musl engine for Alpine)
RUN npx prisma generate

# Copy tsconfig and source code
COPY tsconfig.json ./
COPY src ./src/

# Compile TypeScript to JavaScript in dist/
RUN npm run build

# Remove development dependencies to keep only production dependencies
RUN npm prune --omit=dev

# -------------------------------------------------------------
# Stage 2: Runtime stage (lean, secure, non-root production image)
# -------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

# Install openssl for Prisma runtime
RUN apk add --no-cache openssl

# Set production environment
ENV NODE_ENV=production

# Node image comes with built-in unprivileged user 'node' (uid: 1000)
# Ensure application directory is owned by 'node'
RUN chown -R node:node /app

# Copy production dependencies from builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Copy package.json
COPY --chown=node:node --from=builder /app/package*.json ./

# Copy compiled JavaScript output
COPY --chown=node:node --from=builder /app/dist ./dist

# Copy prisma schema and migrations (needed for prisma client and migrate deploy)
COPY --chown=node:node --from=builder /app/prisma ./prisma

# Switch from root to non-root user for security
USER node

# Expose default HTTP port
EXPOSE 3000

# Default command starts the API server
CMD ["node", "dist/server.js"]
