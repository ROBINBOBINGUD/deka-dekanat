# Запасной способ запуска на любой площадке с Docker (на Amvera используется amvera.yml).
FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
