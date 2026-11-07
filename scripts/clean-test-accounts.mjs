// Removes the accounts automated tests left in the LOCAL database: only emails ending in @test.local, nothing else.
//   npm run db:clean-test           shows how many would go, changes nothing
//   npm run db:clean-test -- --yes  deletes them (permanent)
import { execFileSync } from 'node:child_process';

const CONTAINER = 'oliskey-alpha-app-db';
const psql = (sql) => execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'oliskey_alpha', '-tAc', sql], { encoding: 'utf8' }).trim();
const WHERE = "email like '%@test.local'";

const tests = Number(psql(`select count(*) from auth.users where ${WHERE}`));
const others = Number(psql(`select count(*) from auth.users where not (${WHERE})`));
console.log(`Test accounts (@test.local): ${tests}`);
console.log(`Your other accounts, which are kept: ${others}`);
if (!process.argv.includes('--yes')) {
  console.log('Nothing was changed. To delete the test accounts: npm run db:clean-test -- --yes');
  process.exit(0);
}
psql(`delete from auth.users where ${WHERE}`);
console.log(`Deleted. Test accounts left: ${psql(`select count(*) from auth.users where ${WHERE}`)}. Other accounts: ${psql(`select count(*) from auth.users where not (${WHERE})`)}.`);
