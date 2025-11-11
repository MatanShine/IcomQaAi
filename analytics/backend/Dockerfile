FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps
RUN apk add --no-cache openssl

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

EXPOSE 4001
CMD ["npm", "run", "dev"]