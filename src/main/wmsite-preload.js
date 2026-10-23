'use strict';
// walmart.com inside the Walmart tab (owner 2026-10-23: "whenever you search,
// it shows the Walmart page, and you are able to scroll through and pick a
// listing to list"). This runs in that page's isolated world: it puts a
// "List this" button on every product the page shows and tells the app
// which item number was picked. Nothing from the app is exposed to the
// page; the only thing sent is { itemId, title, price, image } of a product
// the owner clicked. Product cards are found by their /ip/<number> links,
// which Walmart keeps stable through redesigns.

const { ipcRenderer } = require('electron');

const ID_RE = /\/ip\/(?:[^/?#]+\/)?(\d{5,})(?:[/?#]|$)/;
const idOf = (href) => { const m = ID_RE.exec(String(href || '')); return m ? m[1] : ''; };
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const priceIn = (el) => {
  const m = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/.exec(el ? el.innerText || '' : '');
  return m ? Number(m[1].replace(/,/g, '')) : 0;
};

function send(itemId, card) {
  if (!card) { // the product page itself: its heading and main photo
    const og = document.querySelector('meta[property="og:image"]');
    const h1 = document.querySelector('h1');
    ipcRenderer.send('wmsite:pick', { itemId, title: clip(h1 && h1.innerText, 300), price: 0, image: og && /^https:\/\//.test(og.content) ? og.content : '' });
    return;
  }
  const img = card.querySelector('img');
  // the card's longest product-link text (the image link has none)
  const title = [...card.querySelectorAll('a[href*="/ip/"]')].map(a => clip(a.getAttribute('aria-label') || a.innerText, 300))
    .concat(clip(img && img.alt, 300)).sort((a, b) => b.length - a.length)[0] || '';
  ipcRenderer.send('wmsite:pick', {
    itemId,
    title,
    price: priceIn(card),
    image: img && /^https:\/\//.test(img.src) ? img.src : '',
  });
}

function button(label, itemId, card) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dws-list';
  b.textContent = label;
  b.dataset.dwsId = itemId;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    send(itemId, card);
  }, true);
  return b;
}

// the smallest ancestor of a product link that looks like one product card:
// Walmart's own item id attribute first, else a box holding an image and a
// price that is not wider than a card
function cardOf(link) {
  const tagged = link.closest('[data-item-id]');
  if (tagged) return tagged;
  let el = link;
  for (let i = 0; i < 7 && el && el !== document.body; i++, el = el.parentElement) {
    const w = el.offsetWidth;
    if (w > 640) break;
    if (w >= 120 && el.querySelector('img') && priceIn(el)) return el;
  }
  return null;
}

function scan() {
  // search / category / shelf pages: one button per card
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/ip/"]')) {
    const id = idOf(a.href);
    if (!id || seen.has(id)) continue;
    const card = cardOf(a);
    if (!card || card.dataset.dwsCard) { if (card) seen.add(id); continue; }
    seen.add(id);
    card.dataset.dwsCard = id;
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    card.appendChild(button('+ List this', id, card));
  }
  // a product page: one big button for the item itself
  const own = idOf(location.pathname);
  const fixed = document.getElementById('dws-list-page');
  if (own && (!fixed || fixed.dataset.dwsId !== own)) {
    if (fixed) fixed.remove();
    const b = button('+ List this item', own, null);
    b.id = 'dws-list-page';
    document.body.appendChild(b);
  } else if (!own && fixed) {
    fixed.remove();
  }
}

let timer = null;
const later = () => { clearTimeout(timer); timer = setTimeout(scan, 350); };
window.addEventListener('DOMContentLoaded', () => {
  scan();
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
});
// single-page navigations (filters, paging) swap the cards without a load
window.addEventListener('popstate', later);
