/*
 * Fails unless every version the repository declares matches the one given on
 * the command line. The release workflow passes the tag name so a mistyped or
 * unbumped version aborts before anything reaches addons.mozilla.org, which
 * refuses to sign a version it has already seen.
 */

const DECLARING_FILES = ['src/manifest.json', 'package.json'];

const expected = process.argv[2];

if (!expected) {
  console.error('usage: node scripts/check-version.js <version>');
  process.exit(2);
}

const mismatches = DECLARING_FILES.map((file) => ({
  file,
  found: require(`../${file}`).version,
})).filter(({ found }) => found !== expected);

for (const { file, found } of mismatches) {
  console.error(`${file} declares ${found}, expected ${expected}`);
}

if (mismatches.length > 0) process.exit(1);

console.log(
  `version ${expected} agrees across ${DECLARING_FILES.join(' and ')}`,
);
