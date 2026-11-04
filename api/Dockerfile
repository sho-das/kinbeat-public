# The API as one container for Cloud Run. Build from api/: docker build -t kinbeat-api .
# Settings come from the environment at run time, never from a file in the image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The lock file was written by npm 11, which npm 10 in the image cannot read in sync.
RUN npm install -g npm@11 && npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4100
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY db ./db
# Contact messages and the live counts are files under data/. On Cloud Run that folder is a mounted bucket.
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 4100
CMD ["node", "dist/main"]
