FROM node:22-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
CMD ["node", "dist/main.js"]
