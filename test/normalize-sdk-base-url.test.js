import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYokefellowSdkBaseUrl } from '../apps/world-server/normalize-sdk-base-url.js';

test('normalizes a Yokefellow origin to the SDK v1 base URL', () => {
  assert.equal(
    normalizeYokefellowSdkBaseUrl('https://yokefellow1-web.vercel.app'),
    'https://yokefellow1-web.vercel.app/api/sdk/v1',
  );
});

test('normalizes a bucket page URL to the SDK v1 base URL', () => {
  assert.equal(
    normalizeYokefellowSdkBaseUrl('https://yokefellow1-web.vercel.app/bucket/yes-coin-pusher#offerings'),
    'https://yokefellow1-web.vercel.app/api/sdk/v1',
  );
});

test('preserves an existing SDK v1 base URL and removes deeper paths', () => {
  assert.equal(
    normalizeYokefellowSdkBaseUrl('https://yokefellow1-web.vercel.app/api/sdk/v1/buckets/test/offering-events'),
    'https://yokefellow1-web.vercel.app/api/sdk/v1',
  );
});
