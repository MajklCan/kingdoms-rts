# --- build stage ---
FROM node:22-slim AS build
WORKDIR /app

# install deps (devDeps needed: tsc + vite live there)
COPY package.json package-lock.json ./
RUN npm ci

# build the Vite SPA (tsc -b && vite build)
COPY . .
RUN npm run build

# --- serve stage ---
FROM nginx:alpine AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
