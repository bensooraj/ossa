FROM node:12.10.0-slim

WORKDIR /service

RUN npm install -g nodemon

COPY package*.json ./

RUN npm install

COPY . .

ENV PORT 3002

EXPOSE 3002

CMD ["node", "app.js"]