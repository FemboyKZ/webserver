FROM node:25-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY views/ views/
COPY public/ public/

ARG UID=1000
ARG GID=1000

RUN mkdir -p .cache/archives logs
RUN chown -R ${UID}:${GID} /app

USER ${UID}:${GID}

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/ || exit 1

ENTRYPOINT ["node", "src/app.js"]
