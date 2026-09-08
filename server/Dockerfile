# Build the share-play signaling server image.
#
# The server is plain TypeScript run directly by Node's native type stripping
# (Node 22.18+/24+), so there is no compile step.

FROM node:24-alpine

WORKDIR /app

# Install only production dependencies (the server only needs `ws` at runtime).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the server source. `import type` from `@Server/types` is erased at
# runtime, so no path-alias resolution is needed here.
COPY server ./server

EXPOSE 8080

CMD ["node", "server/signaling.ts"]
