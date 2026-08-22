import { openDatabase, currentSeason } from '@ql/db';
import { runPayday, aiSpend } from '@ql/worker/jobs';
import { aiMarket } from '@ql/worker/jobs';

async function main(): Promise<void> {
  const h = await openDatabase();
  const season = await currentSeason(h.db);
  if (!season) throw new Error('no season');
  const time = async (label: string, work: () => Promise<unknown>) => {
    const start = process.hrtime.bigint();
    await work();
    console.log(`  ${label.padEnd(12)} ${(Number(process.hrtime.bigint() - start) / 1e6).toFixed(0)} ms`);
  };
  await time('runPayday', () => runPayday(h.db, { seasonId: season.id, seasonNumber: season.number, matchday: 7 }));
  await time('aiSpend', () => aiSpend(h.db, season.id));
  await time('aiMarket', () => aiMarket(h.db, season.number));
  await h.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
