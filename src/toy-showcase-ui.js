import './skin-ui.css';

function clean(value) {
  return String(value ?? '').trim();
}

function createToyShowcase() {
  if (typeof document === 'undefined') return null;
  const playerCard = document.querySelector('.player-card');
  const skinLocker = document.querySelector('#skinLocker');
  if (!playerCard || document.querySelector('#toyShowcase')) return document.querySelector('#toyShowcase');

  const section = document.createElement('section');
  section.id = 'toyShowcase';
  section.className = 'toy-showcase';
  section.innerHTML = `
    <span class="toy-showcase-label">TOY NFTS</span>
    <div id="toyShowcaseItems" class="toy-showcase-items"></div>
    <span id="toyShowcaseStatus" class="toy-showcase-status">CONNECT WALLET TO LOAD TOYS</span>`;

  if (skinLocker?.parentElement === playerCard) skinLocker.insertAdjacentElement('afterend', section);
  else playerCard.appendChild(section);
  return section;
}

const showcase = createToyShowcase();
const items = showcase?.querySelector('#toyShowcaseItems');
const status = showcase?.querySelector('#toyShowcaseStatus');

function renderToyShowcase(toys = [], message = '') {
  if (!items || !status) return;
  items.replaceChildren();
  const owned = Array.isArray(toys) ? toys : [];

  for (const toy of owned) {
    const card = document.createElement('article');
    card.className = 'toy-showcase-item';

    const image = document.createElement('img');
    image.src = clean(toy.imageUrl) || '/assets/coin-face.svg';
    image.alt = clean(toy.name) || 'YES Pusher toy NFT';

    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = clean(toy.name || toy.toyKey || 'Toy NFT').toUpperCase();
    const meta = document.createElement('small');
    const size = clean(toy.sizeTier);
    const quantity = Math.max(1, Math.floor(Number(toy.quantity) || 1));
    meta.textContent = [size ? size.toUpperCase() : '', quantity > 1 ? `×${quantity}` : ''].filter(Boolean).join(' ');
    copy.append(name, meta);

    card.append(image, copy);
    items.appendChild(card);
  }

  status.textContent = message || (owned.length
    ? `${owned.length} OWNED TOY NFT${owned.length === 1 ? '' : 'S'}`
    : 'NO OWNED TOY NFTS FOUND');
  showcase?.classList.toggle('empty', owned.length === 0);
}

export { createToyShowcase, renderToyShowcase };
