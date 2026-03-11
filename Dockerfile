FROM node:25-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY views/ views/
COPY public/ public/

EXPOSE 4000

ENTRYPOINT ["node", "src/app.js"]
