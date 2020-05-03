FROM node:12.10.0-slim

WORKDIR /service

RUN npm install -g nodemon

COPY package*.json ./

RUN npm install

COPY . .

ENV PORT 3000

EXPOSE 3000

CMD ["node", "app.js"]