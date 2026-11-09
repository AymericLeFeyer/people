# syntax=docker/dockerfile:1

# Aucune dépendance npm : Node 24 fournit `node:sqlite`, le serveur HTTP et fetch.
# L'image ne contient donc que Node et les sources.
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data \
    TZ=Europe/Paris

COPY package.json ./
COPY *.js ./
COPY public/ ./public/

# Base SQLite + photos vivent dans un volume : sans ça, chaque redéploiement les effacerait.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/meta').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
