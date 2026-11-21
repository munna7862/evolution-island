import { APP_NAME, statusLine } from './status.js';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) {
  throw new Error('index.html must contain an element with id "app"');
}

const heading = document.createElement('h1');
heading.textContent = APP_NAME;
const status = document.createElement('p');
status.textContent = statusLine();
root.append(heading, status);
