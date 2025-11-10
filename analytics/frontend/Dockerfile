FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

# Bring in the rest of the app
COPY . .

ENV CHOKIDAR_USEPOLLING=true

EXPOSE 4173
CMD ["npm", "run", "dev"]