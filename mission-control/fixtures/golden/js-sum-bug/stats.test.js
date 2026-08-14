const test = require("node:test");
const assert = require("node:assert");
const { mean, sum } = require("./stats.js");

test("empty list sums to zero", () => {
  assert.strictEqual(sum([]), 0);
});

test("sums the numbers", () => {
  assert.strictEqual(sum([1, 2, 3]), 6);
});

test("mean of a list", () => {
  assert.strictEqual(mean([2, 4]), 3);
});
