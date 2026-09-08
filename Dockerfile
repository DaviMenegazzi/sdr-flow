FROM node:22-alpine AS workspace
RUN npm install --global pnpm@11.24.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

FROM workspace AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
USER node
EXPOSE 3001
CMD ["pnpm", "--filter", "@sdr/api", "start"]

FROM workspace AS worker
ENV NODE_ENV=production
USER node
EXPOSE 3002
CMD ["pnpm", "--filter", "@sdr/worker", "start"]

FROM workspace AS web-build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN pnpm --filter @sdr/web build

FROM nginx:1.28-alpine AS web
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
