# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM caddy:2.7-alpine
COPY --from=deps /app/dist /srv
EXPOSE 80
CMD ["caddy", "file-server", "--listen", ":80", "--root", "/srv"]
