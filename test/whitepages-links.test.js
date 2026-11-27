import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutRecordId, profileLink, candidateProfileLink} from '../pages/whitepages-links.js';

test('extracts checkout wpId, never the whole checkout URL', () => {
  assert.equal(checkoutRecordId('https://www.whitepages.com/checkout/summary?wpId=Px123abc456&wp_source=PersonResults'), 'Px123abc456');
  assert.equal(checkoutRecordId('https://www.whitepages.com/name/Alex-Smith/Denver-CO/Px123abc456'), null);
  assert.equal(checkoutRecordId('https://whitepages.com/checkout/summary?wpId='), null);
  assert.equal(checkoutRecordId('https://whitepages.com.evil.example/checkout/summary?wpId=Px123abc456'), null);
  assert.equal(checkoutRecordId('http://whitepages.com/checkout/summary?wpId=Px123abc456'), null);
});
test('builds only candidate profile URL with provided identity and locality', () => {
  assert.equal(candidateProfileLink({first_name:'Alex',last_name:'Smith',city:'Denver',state:'Colorado'},'Px123abc456'),
    'https://www.whitepages.com/name/Alex-Smith/Denver-CO/Px123abc456');
  assert.equal(candidateProfileLink({first_name:'Alex',last_name:'Smith',city:'',state:'CO'},'Px123abc456'), null);
  assert.equal(candidateProfileLink({first_name:'Alex',last_name:'Smith',city:'Denver',state:'Unknown'},'Px123abc456'), null);
});
test('rejects checkout and search links as copyable profile URLs', () => {
  assert.equal(profileLink('https://www.whitepages.com/checkout/summary?wpId=Px123abc456'), null);
  assert.equal(profileLink('https://www.whitepages.com/name/Alex-Smith/CO'), null);
  assert.equal(profileLink('https://www.whitepages.com/name/Alex-Smith/Denver-CO/Px123abc456'),
    'https://www.whitepages.com/name/Alex-Smith/Denver-CO/Px123abc456');
});
