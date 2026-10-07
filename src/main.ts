import { formatReadout, parseTime } from './lib/time';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

// Placeholder home page. The real search box and story view replace this in
// phase 1. It exists so the deploy pipeline and the smoke test have a page to
// check, and so the first thing the owner sees is a real, styled page.
const examples = ['1889', '800 BC', '20,000 years ago', '66 Ma'];

app.innerHTML = `
  <h1>Snowball</h1>
  <p class="muted">Every place in Washington has a story that starts long before the street did.</p>
  <section class="card">
    <p>Soon: type a Washington address and read the history of that exact spot, ring by ring,
    from the house outward and from today back to the birth of the Earth.</p>
    <p class="muted">The time engine is already here. A few readouts it understands:</p>
    <ul id="readouts"></ul>
  </section>
`;

const list = document.getElementById('readouts');
if (list) {
  for (const text of examples) {
    const li = document.createElement('li');
    const parsed = parseTime(text);
    li.textContent = parsed ? `${text} → ${formatReadout(parsed)}` : `${text} → (not understood)`;
    list.appendChild(li);
  }
}
