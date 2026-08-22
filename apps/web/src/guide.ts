/**
 * The player's guide, served from the game itself.
 *
 * Lives here rather than anywhere external so it ships with the code, is version
 * controlled alongside the rules it describes, and cannot drift away or go
 * offline. The four diagrams are hand-authored inline SVG using `currentColor`,
 * so they follow the site's light and dark themes without a second asset.
 *
 * Every figure in it is measured rather than designed: if you retune the sport,
 * check the numbers here still hold.
 */

import { page, type LayoutOptions } from './layout.js';

export function guidePage(shell: Omit<LayoutOptions, 'title'> = {}): string {
  return page(
    {
      ...shell,
      title: 'How Quidditch Legends works',
      active: '/guide',
      subtitle: 'The guide',
    },
    GUIDE,
  );
}

const GUIDE = `
<section>
  <div class="sec-head">
    <p class="eyebrow">The shape of it</p>
    <h2>The loop you are actually playing</h2>
  </div>
  <div class="col stack">
    <p>Four things happen over and over. You do the first one; the game does the rest and hands you the results.</p>
  </div>

  <figure>
    <div class="figframe">
      <svg viewBox="0 0 920 330" role="img" aria-label="The play loop: pick your team, play the matchday, every club's result is published, money moves, then back to picking. After twenty-two matchdays it branches into the off-season and a new season.">
        <defs>
          <marker id="ar" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="9" markerHeight="7" orient="auto">
            <polygon points="0,0 10,4 0,8" fill="currentColor"/>
          </marker>
        </defs>

        <!-- row of four steps -->
        <g class="n-stroke">
          <rect x="10"  y="40" width="190" height="72" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="248" y="40" width="190" height="72" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="486" y="40" width="190" height="72" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="724" y="40" width="186" height="72" rx="5" class="n-fill" stroke-width="1"/>
        </g>

        <text x="105" y="70"  text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">Pick your team</text>
        <text x="105" y="90"  text-anchor="middle" font-size="11" fill="currentColor" opacity=".72">7 players + tactics</text>
        <text x="343" y="70"  text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">Play the matchday</text>
        <text x="343" y="90"  text-anchor="middle" font-size="11" fill="currentColor" opacity=".72">all 6 fixtures at once</text>
        <text x="581" y="70"  text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">Results published</text>
        <text x="581" y="90"  text-anchor="middle" font-size="11" fill="currentColor" opacity=".72">table, reports, stats</text>
        <text x="817" y="70"  text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">Money moves</text>
        <text x="817" y="90"  text-anchor="middle" font-size="11" fill="currentColor" opacity=".72">gate in, wages out</text>

        <!-- who does what -->
        <text x="105" y="27" text-anchor="middle" font-size="10" letter-spacing="1.4" class="accent" fill="currentColor">YOU</text>
        <text x="343" y="27" text-anchor="middle" font-size="10" letter-spacing="1.4" class="accent" fill="currentColor">YOU PRESS PLAY</text>
        <text x="581" y="27" text-anchor="middle" font-size="10" letter-spacing="1.4" fill="currentColor" opacity=".5">THE GAME</text>
        <text x="817" y="27" text-anchor="middle" font-size="10" letter-spacing="1.4" fill="currentColor" opacity=".5">THE GAME</text>

        <!-- forward arrows -->
        <g stroke="currentColor" stroke-width="1.4" fill="none" marker-end="url(#ar)">
          <line x1="204" y1="76" x2="242" y2="76"/>
          <line x1="442" y1="76" x2="480" y2="76"/>
          <line x1="680" y1="76" x2="718" y2="76"/>
        </g>

        <!-- return arrow -->
        <path d="M 817 116 L 817 158 L 105 158 L 105 120" stroke="currentColor" stroke-width="1.4"
              fill="none" marker-end="url(#ar)" opacity=".75"/>
        <text x="461" y="151" text-anchor="middle" font-size="11" fill="currentColor" opacity=".72">next matchday &mdash; 22 of them in a season</text>

        <!-- season boundary branch -->
        <path d="M 880 116 L 880 210 L 690 210" stroke="currentColor" stroke-width="1.4"
              fill="none" marker-end="url(#ar)" stroke-dasharray="5 4" opacity=".8"/>
        <text x="884" y="170" font-size="11" fill="currentColor" opacity=".72">after 22</text>

        <g class="n-stroke">
          <rect x="440" y="176" width="248" height="68" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="150" y="176" width="248" height="68" rx="5" class="n-fill" stroke-width="1"/>
        </g>
        <text x="564" y="204" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">Off-season</text>
        <text x="564" y="224" text-anchor="middle" font-size="11" fill="currentColor" opacity=".72">develop, decline, retire, intake</text>
        <text x="274" y="204" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">New season</text>
        <text x="274" y="224" text-anchor="middle" font-size="11" fill="currentColor" opacity=".72">fresh fixtures, same clubs</text>

        <line x1="436" y1="210" x2="404" y2="210" stroke="currentColor" stroke-width="1.4" fill="none" marker-end="url(#ar)" opacity=".8"/>
        <path d="M 150 210 L 60 210 L 60 120" stroke="currentColor" stroke-width="1.4" fill="none"
              marker-end="url(#ar)" stroke-dasharray="5 4" opacity=".8"/>

        <text x="10" y="292" font-size="11" fill="currentColor" opacity=".62">Between matchdays you can also change tactics, set a training order, or buy a facility &mdash; none of those are on a clock.</text>
        <text x="10" y="312" font-size="11" fill="currentColor" opacity=".62">Nothing happens while you are away. It is your clock: the world waits for you to press play.</text>
      </svg>
    </div>
    <figcaption>The whole game, in one cycle. You only ever touch the first two boxes &mdash; and the second one is a single button. Everything in the lower half happens once a season.</figcaption>
  </figure>

  <div class="pull">
    <p class="eyebrow">The one thing to know</p>
    <p>When you press play, <strong>the whole division plays</strong>, not just your fixture. All six matches are simulated, every table position moves, and every club's players get tired, injured and paid. A league where only your own match resolved would not be a league.</p>
  </div>
</section>

<section>
  <div class="sec-head">
    <p class="eyebrow">Reading a result</p>
    <h2>What a scoreline is made of</h2>
  </div>
  <div class="col stack">
    <p>Quidditch scores look strange until you see them broken up. There are only two ways to score, and the second one is the reason the numbers are so big.</p>
  </div>

  <div class="score-demo">
    <div class="score-line">
      <span class="club">Hollowell Harriers</span>
      <span class="pts">280</span>
      <span class="note">&ndash;</span>
      <span class="pts">220</span>
      <span class="club">Ashdown Arrows</span>
    </div>
    <div class="sums">
      <div class="sum">
        <div class="who">Hollowell 280</div>
        <div class="row"><span>19 goals &times; 10</span><span>190</span></div>
        <div class="row"><span>3 snitch catches &times; 30</span><span>90</span></div>
        <div class="row total"><span>total</span><span>280</span></div>
      </div>
      <div class="sum">
        <div class="who">Ashdown 220</div>
        <div class="row"><span>16 goals &times; 10</span><span>160</span></div>
        <div class="row"><span>2 snitch catches &times; 30</span><span>60</span></div>
        <div class="row total"><span>total</span><span>220</span></div>
      </div>
      <div class="sum">
        <div class="who">So the match turned on</div>
        <div class="row"><span>goal difference</span><span>+30</span></div>
        <div class="row"><span>snitch difference</span><span>+30</span></div>
        <div class="row total"><span>margin</span><span>60</span></div>
      </div>
    </div>
  </div>

  <div class="col stack">
    <p>A goal is <strong>10 points</strong>, thrown through a hoop by a Chaser. A snitch catch is <strong>30 points</strong> &mdash; and catching it does <em class="term">not</em> end the match. A new snitch goes straight back out, so there are about four catches in a game and your Seeker is a repeat scorer rather than a single coin flip.</p>
    <p>That is a deliberate change from the books, where the snitch is worth 150 and ends the match. At 150-and-over, the Seeker decides everything and the other six players are decoration. At 30-and-continue, a catch is worth three goals: a big swing, not the whole game. Roughly <strong>28% of a team's points</strong> come from the snitch.</p>
    <p class="note">Three points for a win, one for a draw, and draws happen about 4% of the time. Points scored and conceded break ties, the way goal difference does in football.</p>
  </div>
</section>

<section>
  <div class="sec-head">
    <p class="eyebrow">Inside a match</p>
    <h2>Three games happening at once</h2>
  </div>
  <div class="col stack">
    <p>A match is eighty minutes long and three separate contests run through all of it. Your seven players are split across them, which is why a squad can be strong in one place and hopeless in another.</p>
  </div>

  <figure>
    <div class="figframe">
      <svg viewBox="0 0 920 400" role="img" aria-label="Three lanes run across eighty minutes: the quaffle game scoring goals, the bludger game landing hits, and the snitch hunt where each catch is followed by a new snitch being released. All three write into one event log, which produces the score, the stat lines and the after-effects.">
        <defs>
          <marker id="ar2" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="9" markerHeight="7" orient="auto">
            <polygon points="0,0 10,4 0,8" fill="currentColor"/>
          </marker>
        </defs>

        <!-- time axis -->
        <line x1="150" y1="34" x2="880" y2="34" stroke="currentColor" stroke-width="1" opacity=".45"/>
        <g font-size="10" fill="currentColor" opacity=".6" text-anchor="middle">
          <text x="150" y="24">0'</text>
          <text x="332" y="24">20'</text>
          <text x="515" y="24">40'</text>
          <text x="697" y="24">60'</text>
          <text x="880" y="24">80'</text>
        </g>

        <!-- lane 1: quaffle -->
        <text x="10" y="76" font-size="12" font-weight="600" fill="currentColor">Quaffle</text>
        <text x="10" y="93" font-size="10" fill="currentColor" opacity=".6">3 Chasers, 1 Keeper</text>
        <line x1="150" y1="80" x2="880" y2="80" stroke="currentColor" stroke-width="1" opacity=".3"/>
        <g fill="currentColor">
          <circle cx="186" cy="80" r="4"/><circle cx="232" cy="80" r="4"/><circle cx="290" cy="80" r="4"/>
          <circle cx="356" cy="80" r="4"/><circle cx="402" cy="80" r="4"/><circle cx="470" cy="80" r="4"/>
          <circle cx="538" cy="80" r="4"/><circle cx="596" cy="80" r="4"/><circle cx="650" cy="80" r="4"/>
          <circle cx="710" cy="80" r="4"/><circle cx="768" cy="80" r="4"/><circle cx="824" cy="80" r="4"/>
        </g>
        <text x="500" y="108" font-size="11" fill="currentColor" opacity=".72" text-anchor="middle">~120 attacks &rarr; about 30 goals between the two sides &mdash; 10 points each</text>

        <!-- lane 2: bludgers -->
        <text x="10" y="166" font-size="12" font-weight="600" fill="currentColor">Bludgers</text>
        <text x="10" y="183" font-size="10" fill="currentColor" opacity=".6">2 Beaters</text>
        <line x1="150" y1="170" x2="880" y2="170" stroke="currentColor" stroke-width="1" opacity=".3"/>
        <g stroke="currentColor" stroke-width="1.6" opacity=".85">
          <line x1="200" y1="163" x2="200" y2="177"/><line x1="268" y1="163" x2="268" y2="177"/>
          <line x1="330" y1="163" x2="330" y2="177"/><line x1="416" y1="163" x2="416" y2="177"/>
          <line x1="482" y1="163" x2="482" y2="177"/><line x1="560" y1="163" x2="560" y2="177"/>
          <line x1="628" y1="163" x2="628" y2="177"/><line x1="700" y1="163" x2="700" y2="177"/>
          <line x1="782" y1="163" x2="782" y2="177"/><line x1="846" y1="163" x2="846" y2="177"/>
        </g>
        <text x="500" y="198" font-size="11" fill="currentColor" opacity=".72" text-anchor="middle">no points at all &mdash; hits tire and injure opponents, and hold their Seeker off the snitch</text>

        <!-- lane 3: snitch -->
        <text x="10" y="256" font-size="12" font-weight="600" fill="currentColor">Snitch</text>
        <text x="10" y="273" font-size="10" fill="currentColor" opacity=".6">1 Seeker</text>
        <line x1="150" y1="260" x2="880" y2="260" stroke="currentColor" stroke-width="1" opacity=".3"/>
        <g class="accent">
          <circle cx="150" cy="260" r="3.5" fill="currentColor" opacity=".55"/>
          <circle cx="322" cy="260" r="6.5" fill="currentColor"/>
          <circle cx="470" cy="260" r="6.5" fill="currentColor"/>
          <circle cx="672" cy="260" r="6.5" fill="currentColor"/>
          <circle cx="806" cy="260" r="6.5" fill="currentColor"/>
        </g>
        <g font-size="10" class="accent" fill="currentColor" text-anchor="middle">
          <text x="322" y="245">+30</text>
          <text x="470" y="245">+30</text>
          <text x="672" y="245">+30</text>
          <text x="806" y="245">+30</text>
        </g>
        <g stroke="currentColor" stroke-width="1" opacity=".45" stroke-dasharray="3 3">
          <line x1="329" y1="272" x2="329" y2="284"/><line x1="477" y1="272" x2="477" y2="284"/>
          <line x1="679" y1="272" x2="679" y2="284"/>
        </g>
        <text x="500" y="298" font-size="11" fill="currentColor" opacity=".72" text-anchor="middle">each catch releases a new snitch &mdash; the hunt restarts, about four times a match</text>

        <!-- everything into the log -->
        <g stroke="currentColor" stroke-width="1.3" fill="none" marker-end="url(#ar2)" opacity=".7">
          <path d="M 515 88 L 515 318"/>
          <path d="M 515 178 L 515 318"/>
          <path d="M 515 268 L 515 318"/>
        </g>
        <g class="n-stroke">
          <rect x="256" y="322" width="520" height="60" rx="5" class="n-fill" stroke-width="1"/>
        </g>
        <text x="516" y="346" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">one event log, minute by minute</text>
        <text x="516" y="366" text-anchor="middle" font-size="11" fill="currentColor" opacity=".72">the score, every player's stats, injuries and tiredness are all read off it</text>
      </svg>
    </div>
    <figcaption>The quaffle game scores the points, the snitch hunt swings them, and the Beaters score nothing at all &mdash; they exist to disrupt the other two lanes. Every event is written to one log; the score is just that log added up.</figcaption>
  </figure>

  <div class="grid3">
    <div class="card">
      <h3>Chasers &amp; Keeper</h3>
      <p class="note">Your three Chasers attack about 60 times a match; roughly half those attacks reach a shot and just under half of those beat the opposing Keeper. Your own Keeper is doing the same job in reverse.</p>
    </div>
    <div class="card">
      <h3>Beaters</h3>
      <p class="note">They never score. A landed bludger tires the target, briefly makes them worse, and occasionally injures them for real. Sustained beater dominance also suppresses the opposing Seeker &mdash; which is how they win matches without touching the ball.</p>
    </div>
    <div class="card">
      <h3>Seeker</h3>
      <p class="note">The most valuable single player. Each snitch gets steadily easier to catch the longer it is out, so a better Seeker takes more of the four. Three catches to one is 60 points &mdash; six goals' worth.</p>
    </div>
  </div>
</section>

<section>
  <div class="sec-head">
    <p class="eyebrow">Reading a player</p>
    <h2>Seven numbers, four jobs</h2>
  </div>
  <div class="col stack">
    <p>Every player has the same seven attributes. What changes is <em class="term">which ones the position reads</em>. The grid below is the whole thing: a column is a position, and the bars are how much that position cares about each attribute.</p>
  </div>

  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Attribute</th>
          <th>What it does</th>
          <th class="num">Chaser</th>
          <th class="num">Beater</th>
          <th class="num">Keeper</th>
          <th class="num">Seeker</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="k">Flying</td><td>Speed and agility; winning a race to the ball</td>
          <td class="num"><span class="bar"><i style="width:20px"></i><span>.20</span></span></td>
          <td class="num"><span class="bar"><i style="width:20px"></i><span>.20</span></span></td>
          <td class="num"><span class="bar"><i style="width:20px"></i><span>.20</span></span></td>
          <td class="num"><span class="bar"><i style="width:35px"></i><span>.35</span></span></td>
        </tr>
        <tr>
          <td class="k">Handling</td><td>Catching and carrying the quaffle without fumbling</td>
          <td class="num"><span class="bar"><i style="width:30px"></i><span>.30</span></span></td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
          <td class="num"><span class="bar"><i style="width:20px"></i><span>.20</span></span></td>
        </tr>
        <tr>
          <td class="k">Aim</td><td>Shot placement, and putting a bludger where it hurts</td>
          <td class="num"><span class="bar"><i style="width:20px"></i><span>.20</span></span></td>
          <td class="num"><span class="bar"><i style="width:35px"></i><span>.35</span></span></td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
        </tr>
        <tr>
          <td class="k">Strength</td><td>Bludger power and holding position</td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
          <td class="num"><span class="bar"><i style="width:35px"></i><span>.35</span></span></td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
        </tr>
        <tr>
          <td class="k">Vision</td><td>Reading play, interceptions, spotting the snitch</td>
          <td class="num"><span class="bar"><i style="width:20px"></i><span>.20</span></span></td>
          <td class="num"><span class="bar"><i style="width:10px"></i><span>.10</span></span></td>
          <td class="num"><span class="bar"><i style="width:25px"></i><span>.25</span></span></td>
          <td class="num"><span class="bar"><i style="width:30px"></i><span>.30</span></span></td>
        </tr>
        <tr>
          <td class="k">Reflexes</td><td>Saves, and dodging a bludger</td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
          <td class="num"><span class="bar"><i style="width:40px"></i><span>.40</span></span></td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
        </tr>
        <tr>
          <td class="k">Nerve</td><td>Clutch minutes, and shaking off a hit</td>
          <td class="num"><span class="bar"><i style="width:10px"></i><span>.10</span></span></td>
          <td class="num"><span class="bar none"><span>&mdash;</span></span></td>
          <td class="num"><span class="bar"><i style="width:15px"></i><span>.15</span></span></td>
          <td class="num"><span class="bar"><i style="width:15px"></i><span>.15</span></span></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="col stack">
    <p>Each column adds up to 1, so a position rating lands on the same 1&ndash;99 scale as the attributes themselves &mdash; a "58 Chaser" is directly comparable to a "61 Keeper". A player out of position keeps only <strong>85%</strong> of what they would be worth there, so a Beater in goal is not a disaster, just a bad idea.</p>
    <h3>The three numbers that are not attributes</h3>
    <p>Attributes barely move. These three move constantly, and they are what makes team selection a decision rather than a lookup:</p>
  </div>

  <div class="grid3">
    <div class="card">
      <h3>Fitness</h3>
      <p class="note">Drains through a match, recovers between them. A fully drained player keeps just <strong>70%</strong> of their rating &mdash; so a tired 59 plays worse than a fresh 54. This is the one people miss.</p>
    </div>
    <div class="card">
      <h3>Form</h3>
      <p class="note">Rises and falls with performances. Worth about <strong>&plusmn;6%</strong>. A player on a hot streak is genuinely better this week.</p>
    </div>
    <div class="card">
      <h3>Morale</h3>
      <p class="note">Moves with results, and drops hard if the club cannot pay its wages.</p>
    </div>
  </div>

  <div class="pull">
    <p class="eyebrow">Which is why the best XI is not the highest-rated XI</p>
    <p>Picking your seven highest ratings will, after three matchdays, field a team of exhausted stars. Multiply each rating by fitness before you compare: a <strong>59-rated Chaser at 58% fitness plays like a 52</strong>, while a 56 at 96% plays like a 55. Rotation is not politeness &mdash; it is the difference between fielding a 54-rated attack and a 50-rated one.</p>
  </div>
</section>

<section>
  <div class="sec-head">
    <p class="eyebrow">Your decisions</p>
    <h2>The four levers you actually pull</h2>
  </div>
  <div class="col stack">
    <p>Everything you can do falls into one of these. Two are per match, two are longer-term.</p>
  </div>

  <div class="scroll">
    <table>
      <thead>
        <tr><th>Lever</th><th>How often</th><th>What it moves</th></tr>
      </thead>
      <tbody>
        <tr>
          <td class="k">Team selection</td><td class="k">every match</td>
          <td>Which seven play, and in which position. Fitness-adjusted rating is what matters, not raw rating. Anyone you leave out recovers faster.</td>
        </tr>
        <tr>
          <td class="k">Tactics</td><td class="k">whenever</td>
          <td>Three dials, described below. Every option is within a point or two of every other &mdash; they are different bets, not better and worse.</td>
        </tr>
        <tr>
          <td class="k">Training order</td><td class="k">once a season</td>
          <td>One attribute to work on and how hard. Charged weekly. Only helps players whose position actually reads that attribute, and only players who get minutes.</td>
        </tr>
        <tr>
          <td class="k">Facilities</td><td class="k">when you can afford it</td>
          <td>Six things to build. Permanent, and they compound &mdash; but each carries weekly upkeep forever.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="col stack">
    <h3>The three tactical dials</h3>
  </div>
  <div class="grid3">
    <div class="card">
      <h3>Aggression</h3>
      <p class="note"><strong>Attacking</strong> buys more shots and gives up possession. <strong>Defensive</strong> the reverse. Worth a couple of goals either way.</p>
    </div>
    <div class="card">
      <h3>Seeker commitment</h3>
      <p class="note"><strong>Hunt</strong> chases the snitch full-time. <strong>Support</strong> drops the Seeker into open play instead: fewer catches, more goals. A real trade, not a better option.</p>
    </div>
    <div class="card">
      <h3>Beater focus</h3>
      <p class="note"><strong>Seeker</strong> holds their hunter off the snitch. <strong>Chasers</strong> wears down their attack. <strong>Protect</strong> shields your own players and makes them harder to hit.</p>
    </div>
  </div>
  <div class="col stack">
    <p class="note">If you pick no team at all, the game fields your best available side automatically &mdash; exactly what the eleven AI clubs do. You are never punished for not turning up; you are just not adding anything.</p>
  </div>
</section>

<section>
  <div class="sec-head">
    <p class="eyebrow">The money</p>
    <h2>Why winning pays, and why it does not run away</h2>
  </div>
  <div class="col stack">
    <p>One currency, Galleons, earned only &mdash; there is nothing to buy with real money. Its whole job is to make you choose. Winning fills your stadium, which funds facilities, which improve your squad, which wins more matches. That loop would run away with itself if nothing pushed back, so something does.</p>
  </div>

  <figure>
    <div class="figframe">
      <svg viewBox="0 0 900 300" role="img" aria-label="A reinforcing loop: winning raises attendance and prize money, which funds facilities, which improve the squad, which wins more matches. Two brakes push against it: weekly upkeep charged on everything built, and a deliberately flat prize curve.">
        <defs>
          <marker id="ar3" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="9" markerHeight="7" orient="auto">
            <polygon points="0,0 10,4 0,8" fill="currentColor"/>
          </marker>
        </defs>

        <!-- the loop, four nodes in a ring -->
        <g class="n-stroke">
          <rect x="340" y="18"  width="200" height="58" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="656" y="112" width="216" height="58" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="340" y="206" width="200" height="58" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="16"  y="112" width="216" height="58" rx="5" class="n-fill" stroke-width="1"/>
        </g>
        <text x="440" y="43"  text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">Win matches</text>
        <text x="440" y="61"  text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">climb the table</text>
        <text x="764" y="137" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">Money comes in</text>
        <text x="764" y="155" text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">fuller ground, prize money</text>
        <text x="440" y="231" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">Build facilities</text>
        <text x="440" y="249" text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">training, medical, academy…</text>
        <text x="124" y="137" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">Better squad</text>
        <text x="124" y="155" text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">develops faster, fitter</text>

        <!-- clockwise arrows -->
        <g stroke="currentColor" stroke-width="1.5" fill="none" marker-end="url(#ar3)">
          <path d="M 544 52 C 610 58 640 90 700 108"/>
          <path d="M 764 174 C 764 214 640 232 544 235"/>
          <path d="M 340 235 C 244 232 124 214 124 174"/>
          <path d="M 124 108 C 184 90 274 58 336 46"/>
        </g>

        <!-- the brakes -->
        <g class="n-stroke">
          <rect x="600" y="228" width="230" height="52" rx="5" fill="none" stroke-width="1" stroke-dasharray="5 4"/>
        </g>
        <text x="715" y="250" text-anchor="middle" font-size="12" font-weight="600" class="accent" fill="currentColor">Weekly upkeep</text>
        <text x="715" y="268" text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">1.2% of everything you built</text>
        <path d="M 600 254 C 570 254 552 250 546 246" stroke="currentColor" stroke-width="1.5" fill="none"
              marker-end="url(#ar3)" class="accent"/>

        <g class="n-stroke">
          <rect x="64" y="18" width="230" height="52" rx="5" fill="none" stroke-width="1" stroke-dasharray="5 4"/>
        </g>
        <text x="179" y="40" text-anchor="middle" font-size="12" font-weight="600" class="accent" fill="currentColor">Flat prize money</text>
        <text x="179" y="58" text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">1st earns 3.5&times; last, not 12&times;</text>
        <path d="M 294 44 C 312 44 322 44 336 44" stroke="currentColor" stroke-width="1.5" fill="none"
              marker-end="url(#ar3)" class="accent"/>
      </svg>
    </div>
    <figcaption>The ring is the loop that makes winning worth something. The two dashed boxes are the brakes on it: upkeep is charged forever on everything you build, and prize money is deliberately flat. With a steep prize curve the champion pulled away permanently; flattening it made the gap between best- and worst-equipped club <em>shrink</em> season on season instead.</figcaption>
  </figure>

  <div class="scroll">
    <table>
      <thead><tr><th>Money in</th><th class="num">When</th><th>Money out</th><th class="num">When</th></tr></thead>
      <tbody>
        <tr><td>Gate receipts &mdash; capacity &times; how full it is</td><td class="num k">home match</td><td>Player wages</td><td class="num k">weekly</td></tr>
        <tr><td>Appearance fee</td><td class="num k">every match</td><td>Facility upkeep</td><td class="num k">weekly</td></tr>
        <tr><td>Sponsorship</td><td class="num k">weekly</td><td>Training</td><td class="num k">weekly</td></tr>
        <tr><td>Prize money by final position</td><td class="num k">end of season</td><td>Buying a facility</td><td class="num k">one-off</td></tr>
      </tbody>
    </table>
  </div>

  <div class="col stack">
    <p>Attendance follows your league position and recent form, so a good run pays for itself and a bad one bites twice. The benchmark to steer by is borrowed from real football: <strong>wages should be 55&ndash;65% of your income</strong>. Past 80% you cannot build anything; under 40% you are sitting on money that would compound faster as a facility.</p>
    <p class="note">If you cannot cover the wage bill, it is paid anyway &mdash; your balance goes negative and squad morale takes the hit. There is no bankruptcy, just consequences.</p>
  </div>

  <div class="scroll">
    <table>
      <thead><tr><th>Facility</th><th>What it buys you</th></tr></thead>
      <tbody>
        <tr><td class="k">Training ground</td><td>Multiplies what a season of training is worth, up to 1.8&times;</td></tr>
        <tr><td class="k">Medical wing</td><td>Shorter injuries, and fewer of them</td></tr>
        <tr><td class="k">Scouting network</td><td>Narrows the estimate you are shown of a young player's ceiling</td></tr>
        <tr><td class="k">Academy</td><td>Better and more numerous youth players each off-season</td></tr>
        <tr><td class="k">Stadium</td><td>2,000 more seats a level &mdash; the only upgrade that repays itself</td></tr>
        <tr><td class="k">Broom store</td><td>A point of Flying across the whole squad; cheap early, poor value late</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section>
  <div class="sec-head">
    <p class="eyebrow">Between seasons</p>
    <h2>Players get better, older, and then they stop</h2>
  </div>
  <div class="col stack">
    <p>Once the twenty-second matchday is played, one button runs the off-season and starts the next one. Four things happen to every player in the world:</p>
    <ul class="plain">
      <li><strong>They develop.</strong> How much depends on age (a 19-year-old improves several points a season, a 28-year-old barely moves), how much of the season they actually played, your training ground, and how far they still are from their hidden ceiling.</li>
      <li><strong>They age.</strong> From 31 onward they lose ground, faster every year.</li>
      <li><strong>They retire.</strong> Possible from 33, certain by 38.</li>
      <li><strong>Your academy replaces them.</strong> Enough 17- and 18-year-olds to refill the squad to fourteen, pitched below your senior level but with real potential.</li>
    </ul>
    <p>That fixed intake is the only source of new players in the world, which is what keeps talent scarce. <strong>Potential is never shown to you</strong> &mdash; you get your scouts' estimated range, and it narrows as you pay for a better scouting network. That fog is deliberate: it is what will turn the transfer market into judgement rather than arithmetic when it arrives.</p>
  </div>
  <div class="pull">
    <p class="eyebrow">Development is gated on minutes</p>
    <p>A prospect who sat on the bench all season improves barely at all, however hard your squad trained. That is the whole reason to risk playing one &mdash; and the reason a thin squad is expensive in a way the table does not show until next year.</p>
  </div>
</section>

<section>
  <div class="sec-head">
    <p class="eyebrow">Under the hood</p>
    <h2>Where each piece lives</h2>
  </div>
  <div class="col stack">
    <p>Worth knowing roughly, because it explains why some things are commands and some are buttons &mdash; and why the match engine can be tested and re-tested without a database in sight.</p>
  </div>

  <figure>
    <div class="figframe">
      <svg viewBox="0 0 900 260" role="img" aria-label="The match engine is a pure function with no database access. The worker calls it to play matchdays and writes results to Postgres. The website only reads from Postgres. The balance harness calls the engine directly, a hundred thousand times, without any database.">
        <defs>
          <marker id="ar4" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="9" markerHeight="7" orient="auto">
            <polygon points="0,0 10,4 0,8" fill="currentColor"/>
          </marker>
        </defs>

        <!-- pure boundary -->
        <rect x="12" y="14" width="252" height="176" rx="6" fill="none" stroke="currentColor"
              stroke-width="1" stroke-dasharray="5 4" opacity=".55"/>
        <text x="20" y="34" font-size="10" letter-spacing="1.3" fill="currentColor" opacity=".55">NO DATABASE IN HERE</text>

        <g class="n-stroke">
          <rect x="30" y="46" width="216" height="62" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="30" y="124" width="216" height="52" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="358" y="46" width="188" height="62" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="358" y="140" width="188" height="52" rx="5" class="n-fill" stroke-width="1"/>
          <rect x="654" y="88" width="216" height="62" rx="5" class="n-fill" stroke-width="1"/>
        </g>

        <text x="138" y="70"  text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">The match engine</text>
        <text x="138" y="88"  text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">squads + seed &rarr; event log</text>
        <text x="138" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Balance harness</text>
        <text x="138" y="163" text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">100,000 matches, no data saved</text>

        <text x="452" y="70"  text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">The worker</text>
        <text x="452" y="88"  text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">plays matchdays, pays wages</text>
        <text x="452" y="163" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">The website</text>
        <text x="452" y="180" text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">what you click</text>

        <text x="762" y="112" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">The database</text>
        <text x="762" y="130" text-anchor="middle" font-size="10.5" fill="currentColor" opacity=".68">clubs, players, every result</text>

        <g stroke="currentColor" stroke-width="1.4" fill="none" marker-end="url(#ar4)">
          <line x1="250" y1="70" x2="352" y2="70"/>
          <line x1="550" y1="82" x2="650" y2="102"/>
          <line x1="650" y1="136" x2="552" y2="158"/>
        </g>
        <path d="M 452 112 L 452 136" stroke="currentColor" stroke-width="1.4" fill="none" marker-end="url(#ar4)" opacity=".7"/>

        <text x="301" y="60"  text-anchor="middle" font-size="10" fill="currentColor" opacity=".7">calls</text>
        <text x="608" y="82"  text-anchor="middle" font-size="10" fill="currentColor" opacity=".7">writes</text>
        <text x="600" y="158" text-anchor="middle" font-size="10" fill="currentColor" opacity=".7">reads</text>
        <text x="462" y="128" font-size="10" fill="currentColor" opacity=".7">presses play</text>

        <text x="12" y="228" font-size="11" fill="currentColor" opacity=".62">The engine never touches storage, which is why the same code can play your league, run a hundred thousand test matches,</text>
        <text x="12" y="246" font-size="11" fill="currentColor" opacity=".62">and replay any past match exactly &mdash; it is given everything it needs and hands back a list of what happened.</text>
      </svg>
    </div>
    <figcaption>The dashed boundary is the important part. The engine is handed two squads, a rule set and a random seed, and returns a list of events &mdash; it cannot read or write anything. Everything else is plumbing around that.</figcaption>
  </figure>

  <div class="grid2">
    <div class="card">
      <div style="display:flex;align-items:baseline;gap:9px;flex-wrap:wrap"><h3>Things you click</h3><span class="tag you">the site</span></div>
      <p class="note">Table, fixtures, results and match reports; your dashboard, team selection, tactics, training, facilities, finances and squad. <code>npm run web</code>, then <span class="mono">localhost:3000</span>.</p>
    </div>
    <div class="card">
      <div style="display:flex;align-items:baseline;gap:9px;flex-wrap:wrap"><h3>Things you type</h3><span class="tag auto">the terminal</span></div>
      <p class="note">Building a world, creating a season, playing matchdays in bulk, the off-season, and the balance tools. Useful for setting up and for skipping ahead; not needed to play.</p>
    </div>
  </div>

  <div class="scroll">
    <table>
      <thead><tr><th>Command</th><th>What it does</th></tr></thead>
      <tbody>
        <tr><td class="k">npm run web</td><td>The site. This is the game.</td></tr>
        <tr><td class="k">npm run world:new</td><td>Build twelve clubs and 168 players from scratch</td></tr>
        <tr><td class="k">npm run season:new</td><td>A division, 22 matchdays, 132 fixtures</td></tr>
        <tr><td class="k">npm run season:run</td><td>Play every remaining matchday at once, about four seconds</td></tr>
        <tr><td class="k">npm run table &middot; finances &middot; leaders</td><td>Read the league, the money, the top scorers</td></tr>
        <tr><td class="k">npm run report</td><td>Re-print the last match report in the terminal</td></tr>
        <tr><td class="k">npm run balance &middot; matrix &middot; tactics</td><td>The measuring tools: is the sport fair, is any squad shape or tactic simply correct</td></tr>
      </tbody>
    </table>
  </div>

  <div class="col stack">
    <p class="note">One practical catch: the database only allows one program at a time, so stop the site before running a terminal command and vice versa. It will tell you rather than corrupting anything.</p>
  </div>
</section>

<section>
  <div class="sec-head">
    <p class="eyebrow">Not built yet</p>
    <h2>What is deliberately missing</h2>
  </div>
  <div class="col stack">
    <p>Two things you might expect and will not find. <strong>There is no transfer market</strong> &mdash; you develop the players you have, and the only new ones come through your academy. And <strong>there is no promotion or relegation</strong>: one division of twelve, playing each other twice.</p>
    <p>Both are next. The market comes first, priced against the house rather than other managers, along with scout reports you pay for and contracts that have to be renewed. The division pyramid and a knockout cup come after it.</p>
  </div>
</section>

<footer>
  <p class="note">Everything in this document describes behaviour that is built and measured, not planned. The numbers &mdash; 28% of points from the snitch, 70% of rating when exhausted, 55&ndash;65% wages of income &mdash; come from running the game, not from designing it.</p>
</footer>
`;
