FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@11.19.0 \
    && pnpm install --frozen-lockfile --prod

COPY src ./src

USER node
EXPOSE 10000
CMD ["npm", "start"]
