import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../lib/cookieConsent.js', import.meta.url), 'utf8');
async function load(id) {
  return import(`data:text/javascript;base64,${Buffer.from(`${source}\n// ${id}`).toString('base64')}`);
}

test('cookie choices notify UI and remain readable if browser storage is blocked', async () => {
  const events = [];
  globalThis.window = {
    localStorage: {
      getItem() { throw new Error('storage blocked'); },
      setItem() { throw new Error('storage blocked'); },
    },
    dispatchEvent(event) { events.push(event.detail); },
  };
  try {
    const consent = await load('blocked');
    assert.equal(consent.getCookieConsent(), null);
    consent.setCookieConsent('declined');
    assert.equal(consent.getCookieConsent(), 'declined');
    consent.setCookieConsent('accepted');
    assert.equal(consent.getCookieConsent(), 'accepted');
    assert.deepEqual(events, ['declined', 'accepted']);
  } finally {
    delete globalThis.window;
  }
});

test('clearing saved consent in another tab restores the undecided state', async () => {
  let saved = null;
  globalThis.window = {
    localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } },
    dispatchEvent() {},
  };
  try {
    const consent = await load('cross-tab');
    consent.setCookieConsent('accepted');
    assert.equal(consent.getCookieConsent(), 'accepted');
    saved = null;
    assert.equal(consent.getCookieConsent(), null);
    consent.setCookieConsent('invalid');
    assert.equal(saved, null);
  } finally {
    delete globalThis.window;
  }
});


test('a full storage quota still applies the new choice in this page', async () => {
  globalThis.window = {
    localStorage: {
      getItem: () => 'accepted',
      setItem() { throw new Error('quota exceeded'); },
    },
    dispatchEvent() {},
  };
  try {
    const consent = await load('quota');
    consent.setCookieConsent('declined');
    assert.equal(consent.getCookieConsent(), 'declined');
  } finally {
    delete globalThis.window;
  }
});
