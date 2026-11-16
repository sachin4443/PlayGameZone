import 'dotenv/config';

// Tests always run against the dedicated test database, never the dev/prod one.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL must be set to run the tests');
if (!/_test(\?|$)/.test(testUrl)) throw new Error('TEST_DATABASE_URL must point at a database whose name ends with "_test"');
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'dev';

// Application code must be imported only AFTER the environment above is set
// (static imports are hoisted and would connect to the wrong database).
import { beforeAll } from 'vitest';
beforeAll(async () => {
  const { firstTurn } = await import('../src/modules/games/games.service');
  firstTurn.pick = () => 0; // tests need a known first player; production draws it at random
});
