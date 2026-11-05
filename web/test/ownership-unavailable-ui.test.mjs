import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("an unavailable ownership projection does not leave infinite loading placeholders", () => {
  assert.match(source, /function showStateUnavailable\(\)/);
  assert.match(source, /if \(generation === stateRefreshGeneration\) showStateUnavailable\(\)/);
  assert.match(source, /homeEquipped\.textContent = "Coin Skin ownership temporarily unavailable\."/);
  assert.match(source, /homeToys\.textContent = "Toy collection temporarily unavailable\."/);
  assert.match(source, /fundingBalance\.textContent = "Unavailable"/);
  assert.match(source, /workshopList\.textContent = "Toy collection temporarily unavailable\."/);
  assert.match(source, /setAppMessage\("NFT ownership is temporarily unavailable\. Refresh to retry\."/);
});

test("ownership outages never allow deposits, withdrawals, or fabricated NFT counts", () => {
  assert.match(source, /for \(const field of \[depositAmount, withdrawAmount, depositButton, withdrawButton\]\)/);
  assert.match(source, /if \(field\) field\.disabled = true/);
  assert.match(source, /playerState = null;/);
  assert.match(source, /homeToys\.textContent = "Toy collection temporarily unavailable\."/);
  assert.match(source, /fundingRefresh\.disabled = false/);
});
