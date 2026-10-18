export class BaseballGameState {
  constructor({ away, home, innings = 3, playerOnlyAtBat = false }) {
    this.teams = { away, home };
    this.innings = innings;
    this.playerOnlyAtBat = playerOnlyAtBat;
    this.reset();
  }

  reset() {
    this.score = { away: 0, home: 0 };
    this.batting = 'away';
    this.inning = 1;
    this.outs = 0;
    this.balls = 0;
    this.strikes = 0;
    this.bases = [false, false, false];
    this.gameOver = false;
    this.lastResult = '';
  }

  get pitching() { return this.batting === 'away' ? 'home' : 'away'; }
  get half() { return this.batting === 'away' ? 'TOP' : 'BOTTOM'; }

  ball() {
    if (this.gameOver) return { type: 'none' };
    this.balls += 1;
    if (this.balls < 4) return { type: 'ball', count: `${this.balls}-${this.strikes}` };
    this.walk();
    return { type: 'walk' };
  }

  strike() {
    if (this.gameOver) return { type: 'none' };
    this.strikes += 1;
    if (this.strikes < 3) return { type: 'strike', count: `${this.balls}-${this.strikes}` };
    return this.addOut('strikeout');
  }

  foul() {
    if (this.gameOver) return { type: 'none' };
    if (this.strikes < 2) this.strikes += 1;
    this.lastResult = 'FOUL BALL';
    return { type: 'foul', count: `${this.balls}-${this.strikes}` };
  }

  addOut(reason = 'out') {
    if (this.gameOver) return { type: 'none' };
    this.outs += 1;
    this.clearCount();
    if (this.outs >= 3) {
      this.changeSides();
      return { type: 'side-change', reason };
    }
    this.lastResult = reason.toUpperCase();
    return { type: 'out', reason };
  }

  hit(basesEarned, { homeRun = false, runnerAdvance = 1 } = {}) {
    if (this.gameOver) return { type: 'none' };
    let runs = 0;
    if (homeRun) {
      runs = 1;
      for (const occupied of this.bases) if (occupied) runs += 1;
      this.bases = [false, false, false];
      this.score[this.batting] += runs;
      this.clearCount();
      this.lastResult = 'HOME RUN';
      return { type: 'home-run', runs };
    }
    const next = [false, false, false];
    const extraRunnerBases = Math.max(0, Math.min(1, Math.floor(runnerAdvance)));
    for (let i = 2; i >= 0; i -= 1) {
      if (!this.bases[i]) continue;
      const destination = i + extraRunnerBases;
      if (destination >= 3) runs += 1;
      else next[destination] = true;
    }
    if (basesEarned >= 4) runs += 1;
    else next[basesEarned - 1] = true;
    this.bases = next;
    this.score[this.batting] += runs;
    this.clearCount();
    this.lastResult = ['SINGLE', 'DOUBLE', 'TRIPLE'][Math.min(basesEarned, 3) - 1] || 'HIT';
    return { type: 'hit', bases: basesEarned, runs };
  }

  resolveFieldingPlay({ batterOut = false, batterBases = 0, runnerOuts = [], runnersAdvance = 1, reason = 'fielded ball' } = {}) {
    if (this.gameOver) return { type: 'none' };
    const outsOnPlay = runnerOuts.length + (batterOut ? 1 : 0);
    const inningEndingOut = this.outs + outsOnPlay >= 3;
    const nextBases = [false, false, false];
    let runs = 0;

    // Third-out plays do not score runs. Otherwise advance each runner who
    // was not retired, then place the batter if they reached safely.
    if (!inningEndingOut) {
      const runnerAdvance = Math.max(0, Math.min(1, Math.floor(runnersAdvance)));
      for (let base = 2; base >= 0; base -= 1) {
        if (!this.bases[base] || runnerOuts.includes(base)) continue;
        const destination = base + runnerAdvance;
        if (destination >= 3) runs += 1;
        else nextBases[destination] = true;
      }
      if (!batterOut && batterBases > 0) {
        const destination = batterBases - 1;
        if (destination >= 3) runs += 1;
        else nextBases[destination] = true;
      }
    }

    this.score[this.batting] += runs;
    this.bases = nextBases;
    this.outs += outsOnPlay;
    this.clearCount();
    if (this.outs >= 3) {
      this.changeSides();
      return { type: 'side-change', reason, runs: 0, outs: outsOnPlay };
    }
    this.lastResult = reason.toUpperCase();
    return {
      type: batterOut && runnerOuts.length ? 'double-play' : batterOut || runnerOuts.length ? 'out' : 'hit',
      reason, runs, outs: outsOnPlay, bases: batterBases,
    };
  }

  walk() {
    let runs = 0;
    if (this.bases[0]) {
      this.bases[0] = false;
      if (this.bases[1]) {
        this.bases[1] = false;
        if (this.bases[2]) runs += 1;
        this.bases[2] = true;
      }
      this.bases[1] = true;
    }
    this.bases[0] = true;
    this.score[this.batting] += runs;
    this.clearCount();
    this.lastResult = 'WALK';
  }

  clearCount() { this.balls = 0; this.strikes = 0; }

  changeSides() {
    this.outs = 0;
    this.bases = [false, false, false];
    this.clearCount();
    if (this.playerOnlyAtBat) {
      this.batting = 'away';
      this.inning += 1;
      if (this.inning > this.innings && this.score.away !== this.score.home) {
        this.gameOver = true;
        this.inning -= 1;
        this.lastResult = this.score.away > this.score.home ? 'AWAY WINS' : 'HOME WINS';
        return;
      }
      this.lastResult = this.inning > this.innings ? 'EXTRA INNINGS' : 'NEXT INNING';
      return;
    }
    if (this.batting === 'away') {
      this.batting = 'home';
      this.lastResult = 'SIDE RETIRED';
      return;
    }
    this.inning += 1;
    this.batting = 'away';
    if (this.inning > this.innings && this.score.away !== this.score.home) {
      this.gameOver = true;
      this.inning -= 1;
      this.lastResult = this.score.away > this.score.home ? 'AWAY WINS' : 'HOME WINS';
      return;
    }
    this.lastResult = this.inning > this.innings ? 'EXTRA INNINGS' : 'NEXT INNING';
  }
}

export function fairBallAt(x, z) {
  return z >= 0 && Math.abs(x) <= Math.max(0.7, z);
}

export function hitTypeFromFlight({ distance, peakHeight, flightTime }) {
  if (peakHeight > 17 && distance > 43) return 4;
  if (distance > 49) return 3;
  if (distance > 33) return 2;
  if (distance > 17) return 1;
  if (flightTime > 0.72 && peakHeight > 5) return 1;
  return 1;
}
