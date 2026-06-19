FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm config set registry https://registry.npmjs.org/ \
  && npm install --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
