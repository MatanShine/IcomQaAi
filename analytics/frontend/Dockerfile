FROM node:18-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

EXPOSE 4173
CMD ["npm", "run", "preview"]
