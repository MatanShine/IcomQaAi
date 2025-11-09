FROM node:18-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

EXPOSE 4001
CMD ["npm", "run", "start"]
