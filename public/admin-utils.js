'use strict';

function slugify(value) {
  return String(value || '').normalize('NFC').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 160);
}
if (typeof module !== 'undefined' && module.exports) module.exports = { slugify };
if (typeof window !== 'undefined') window.StoreAdminUtils = { slugify };
