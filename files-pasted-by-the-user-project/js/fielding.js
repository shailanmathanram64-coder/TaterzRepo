// Shared fielding rules. Distances use the game's metre-like field coordinates.
export const FIELDING_RUN_SPEED = 4.2;
export const BASE_RUN_SPEED = 7.2;
export const THROW_SPEED = 42;
const GLOVE_REACH = 0.42;
const PICKUP_DELAY = 0.98;
const CONTACT_CATCH_CHANCE = { weak: 0.9, good: 0.1 };

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pointAt = (start, velocity, time, gravity) => ({
  x: start.x + velocity.x * time,
  y: start.y + velocity.y * time - 0.5 * gravity * time * time,
  z: start.z + velocity.z * time,
});

function landingTimeFor(start, velocity, gravity) {
  const discriminant = velocity.y * velocity.y + 2 * gravity * Math.max(0, start.y - 0.12);
  const time = (velocity.y + Math.sqrt(discriminant)) / gravity;
  return Math.max(0.12, time);
}

/** Choose the first reachable catch; otherwise choose the quickest fielder to the landing point. */
export function planFieldingPlay({ start, velocity, gravity = 9.81, contactQuality = 1, fielders = [], baseLocations = [], homeLocation = { x: 0, y: 0.12, z: 0.25 }, grounderOnly = false }) {
  const landingTime = landingTimeFor(start, velocity, gravity);
  const landing = pointAt(start, velocity, landingTime, gravity);
  landing.y = 0.12;

  let catchOpportunity = null;
  for (let time = 0.1; !grounderOnly && time < landingTime; time += 0.075) {
    const ball = pointAt(start, velocity, time, gravity);
    // Only attempt catches in a playable height range and when the fielder
    // arrives with a little room to react. This keeps reachable fly balls
    // from becoming automatic outs.
    if (ball.y < 0.75 || ball.y > 3.2) continue;
    const reachable = fielders
      .map((fielder) => ({
        fielder,
        arrival: Math.max(0, distance(fielder.position, ball) - GLOVE_REACH) / FIELDING_RUN_SPEED,
      }))
      .filter(({ arrival }) => arrival <= time - 0.2)
      .sort((a, b) => a.arrival - b.arrival);
    if (reachable.length) {
      catchOpportunity = { fielder: reachable[0].fielder, ball, time };
      break;
    }
  }

  if (catchOpportunity) {
    const chance = contactQuality <= 0.68 ? CONTACT_CATCH_CHANCE.weak : CONTACT_CATCH_CHANCE.good;
    if (Math.random() < chance) {
      return {
        type: 'catch', fielderId: catchOpportunity.fielder.id,
        target: { x: catchOpportunity.ball.x, y: catchOpportunity.ball.y, z: catchOpportunity.ball.z },
        time: catchOpportunity.time, landingTime, landing,
      };
    }
  }

  const arrivals = fielders.map((fielder) => ({
    fielder,
    arrival: Math.max(0, distance(fielder.position, landing) - GLOVE_REACH) / FIELDING_RUN_SPEED,
  })).sort((a, b) => a.arrival - b.arrival);
  const chosen = arrivals[0];
  const coverage = {};
  const baseDefenders = {};
  const bases = baseLocations.length >= 3 ? baseLocations : [
    { x: -19.4, y: 0.12, z: 19.4 },
    { x: 0, y: 0.12, z: 38.8 },
    { x: 19.4, y: 0.12, z: 19.4 },
  ];
  // Keep a unique infielder responsible for every bag and home while the ball
  // fielder leaves their normal position. Prefer the named baseman, then the
  // closest available infielder to fill that spot.
  const helpers = fielders.filter((fielder) => fielder.fieldingGroup === 'infield'
    && fielder.id !== chosen?.fielder.id);
  const assigned = new Set();
  const coverageSlots = [
    ...['first', 'second', 'third'].map((role, index) => [role, bases[index]]),
    ['home', homeLocation],
  ];
  for (const [role, base] of coverageSlots) {
    const available = helpers.filter((fielder) => !assigned.has(fielder.id));
    const defender = available.find((fielder) => fielder.id === role)
      || available.slice().sort((a, b) => distance(a.position, base) - distance(b.position, base))[0];
    if (!defender) continue;
    assigned.add(defender.id);
    baseDefenders[role] = defender.id;
    coverage[defender.id] = { x: base.x, y: 0, z: base.z };
  }
  return {
    type: 'ground', fielderId: chosen?.fielder.id || null,
    target: { x: landing.x, y: 0.12, z: landing.z },
    landingTime, pickupTime: Math.max(landingTime, (chosen?.arrival || 0) + PICKUP_DELAY),
    landing, coverage, baseDefenders,
  };
}

function routeDistance(fromIndex, toIndex, baseLocations, home) {
  if (toIndex <= fromIndex) return 0;
  let total = 0;
  let from = baseLocations[fromIndex];
  for (let index = fromIndex + 1; index <= toIndex; index += 1) {
    const to = index >= 3 ? home : baseLocations[index];
    total += distance(from, to);
    from = to;
  }
  return total;
}

/** Choose a bag for the fielder to throw to and decide if the runner beats it. */
export function decideGroundPlay({ plan, bases, outs = 0, baseLocations, home = { x: 0, z: 0 }, batterBases = 1, runnersAdvance = 1 }) {
  const fieldingPosition = plan.target;
  const result = {
    batterOut: false, batterBases, runnerOuts: [], runnersAdvance, reason: 'safe hit',
    throwTarget: null, throwTargetId: null, throwTime: 0,
  };
  const first = baseLocations[0];
  const batterFirstTime = distance(home, first) / BASE_RUN_SPEED;

  // Determine how far the force chain reaches: a runner is forced only while
  // every base behind them is occupied.
  let forceThrough = -1;
  if (bases[0]) {
    forceThrough = 0;
    while (forceThrough < 2 && bases[forceThrough + 1]) forceThrough += 1;
  }

  const runnerOptions = [];
  for (let runner = 2; runner >= 0; runner -= 1) {
    if (!bases[runner]) continue;
    const forced = runner <= forceThrough;
    // A force can be made at the very next bag. Otherwise target the runner's
    // intended destination so the throw goes where they are actually headed.
    const destinationIndex = forced ? runner + 1 : runner + Math.max(1, runnersAdvance);
    const destination = destinationIndex >= 3 ? home : baseLocations[destinationIndex];
    const runnerTime = routeDistance(runner, destinationIndex, baseLocations, home) / BASE_RUN_SPEED;
    const throwTime = distance(fieldingPosition, destination) / THROW_SPEED;
    const margin = runnerTime - plan.pickupTime - throwTime;
    runnerOptions.push({ runner, forced, destinationIndex, destination, runnerTime, throwTime, margin });
  }

  // Take the best available force first. If no force is possible, throw at the
  // lead runner's next bag. The bag is still targeted when the runner is safe.
  const forceOptions = runnerOptions.filter((option) => option.forced).sort((a, b) => b.margin - a.margin);
  const chosenRunner = forceOptions.find((option) => option.margin >= 0.05)
    || runnerOptions.find((option) => option.forced)
    || runnerOptions[0];

  if (chosenRunner) {
    result.throwTarget = { x: chosenRunner.destination.x, y: 0.12, z: chosenRunner.destination.z };
    result.throwTargetId = chosenRunner.destinationIndex >= 3
      ? plan.baseDefenders?.home || 'pitcher'
      : plan.baseDefenders?.[['first', 'second', 'third'][chosenRunner.destinationIndex]] || null;
    result.throwTime = chosenRunner.throwTime;
    if (outs < 3 && chosenRunner.margin >= 0.05) {
      result.runnerOuts.push(chosenRunner.runner);
      result.reason = chosenRunner.forced ? 'force out' : 'tag out';
    }
    return result;
  }

  result.throwTarget = { x: first.x, y: 0.12, z: first.z };
  result.throwTargetId = plan.baseDefenders?.first || null;
  result.throwTime = distance(fieldingPosition, first) / THROW_SPEED;
  if (outs < 3 && plan.pickupTime + result.throwTime <= batterFirstTime + 0.1) {
    result.batterOut = true;
    result.batterBases = 0;
    result.reason = 'out at first';
  }
  return result;
}
