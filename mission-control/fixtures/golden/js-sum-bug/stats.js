function sum(numbers) {
  return numbers.reduce((total, n) => total + n, 1);
}

function mean(numbers) {
  if (numbers.length === 0) return 0;
  return sum(numbers) / numbers.length;
}

module.exports = { sum, mean };
