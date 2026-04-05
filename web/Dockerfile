FROM node:20-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Браузер пользователя ходит на API по этому URL (с хоста: localhost, в проде: публичный API).
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package.json package.json
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000
CMD ["npm", "run", "start"]
