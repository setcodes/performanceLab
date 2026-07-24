FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV VITE_MVT_BASE_URL=/tiles
RUN npm run build

FROM nginx:1.27-alpine

LABEL org.opencontainers.image.source="https://github.com/setcodes/performanceLab"

COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 4173

HEALTHCHECK --interval=5s --timeout=3s --retries=30 \
  CMD wget -qO- http://127.0.0.1:4173/ >/dev/null || exit 1
