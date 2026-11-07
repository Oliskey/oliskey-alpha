# The hosted server: one port with the API, the live stream, the web app and the AI engine (Railway). Settings come from the host, never from this image.
FROM node:22-bookworm-slim AS web
WORKDIR /repo
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY backend/package.json backend/
RUN npm ci --no-audit --no-fund
COPY app app
COPY scripts scripts
RUN cd app && npx expo export -p web --output-dir dist \
 && cd .. && node -e "import('./scripts/seo.mjs').then((m)=>m.applySeo('app/dist'))" \
 && node scripts/offline-list.mjs app/dist

FROM python:3.14-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /repo
COPY intel/requirements.txt intel/requirements.txt
RUN pip install --no-cache-dir -r intel/requirements.txt
COPY --from=web /repo/node_modules node_modules
COPY --from=web /repo/app/dist app/dist
COPY package.json ./
COPY backend backend
COPY scripts scripts
COPY intel intel
COPY docs/intel docs/intel
# The models trained and tested on the owner's PC. The server has no 4-year history until retraining is switched on.
COPY intel/seed-models intel/models
ENV LOCALAPPDATA=/data INTEL_PYTHON=/usr/local/bin/python NODE_ENV=production TRUST_PROXY=1 PYTHONUNBUFFERED=1
# /data is the permanent disk: price history and saved prices stay across deploys
CMD ["sh", "-c", "mkdir -p /data/oliskey-alpha/updown-cache/all && exec node scripts/run-server.mjs"]
