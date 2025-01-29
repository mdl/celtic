// ----------------------------------
// 1. Definitions
// ----------------------------------
interface Skill {
  skillName: string;
  castTimeS: number;           // How long it takes to cast
  recastTimeS: number;         // Base cooldown after finishing
  damage: number;              // How much damage one cast does
  possibleSkillGear: number[]; // e.g. [0, 10, 30] => recast can be reduced by 0%, 10%, or 30%
}

// A convenience type for the scheduling result
interface ScheduleResult {
  totalDamage: number;
  sequence: string[];
}

/**
 * generateAllGearChoices:
 *   Returns all ways of picking *exactly one* recast-% from each skill's possibleSkillGear.
 *   E.g. if skill1 has gear [0,10], skill2 has gear [15], => [[0,15], [10,15]].
 */
function generateAllGearChoices(skills: Skill[]): number[][] {
  const results: number[][] = [];
  const gearArrays = skills.map(s => s.possibleSkillGear);

  function backtrack(index: number, current: number[]) {
    if (index === skills.length) {
      results.push([...current]);
      return;
    }
    for (const gearPercent of gearArrays[index]) {
      current[index] = gearPercent;
      backtrack(index + 1, current);
    }
  }

  backtrack(0, []);
  return results;
}

// ----------------------------------
// 2. Branch-and-Bound DFS to Maximize Damage
// ----------------------------------
/**
 * Given a chosen gear configuration, find the best (maximum damage) schedule
 * within timeLimit seconds. We do a DFS over possible next skill to cast:
 *   - We track 'currentTime'
 *   - Each skill has a 'nextAvailableTime'
 *   - We only cast if nextAvailableTime <= currentTime, and if the cast ends before timeLimit
 *   - Accumulate damage and keep track of best schedule
 *
 * This method returns the maximum totalDamage (and the sequence of skill casts).
 */
function findBestDamageSchedule(
  skills: Skill[],
  gearCombo: number[],  // e.g. [10, 0, 15], one % recast reduction for each skill
  timeLimit: number     // total time window (seconds) in which to cast
): ScheduleResult {
  // Precompute effective recast times for each skill
  // e.g. 30 => means 30% recast reduction => skill.recastTimeS * (1 - 0.30)
  const effectiveRecast = skills.map((skill, i) => {
    const pct = gearCombo[i] / 100;
    return skill.recastTimeS * (1 - pct);
  });

  // Global best tracking
  let bestDamageSoFar = 0;
  let bestSequenceSoFar: string[] = [];

  /**
   * DFS state:
   *   - currentTime
   *   - totalDamageSoFar
   *   - nextAvailTimes[]: next time each skill is off cooldown
   *   - castSequence: list of skill names so far
   */
  function dfs(
    currentTime: number,
    totalDamageSoFar: number,
    nextAvailTimes: number[],
    castSequence: string[]
  ) {
    // If we've reached a new best, record it
    if (totalDamageSoFar > bestDamageSoFar) {
      bestDamageSoFar = totalDamageSoFar;
      bestSequenceSoFar = [...castSequence];
    }

    // Optional: we can attempt a bounding check here, for example:
    // - If there's not enough time to surpass the bestDamageSoFar, prune.
    //   But that typically requires estimating max potential damage from here on out,
    //   which we won't do for simplicity.

    // Try to cast each skill next
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i];
      const earliestStart = nextAvailTimes[i]; // can't start skill i before this
      if (earliestStart > timeLimit) {
        // If it won't even become available before time limit, no use
        continue;
      }

      // We'll start at max(currentTime, earliestStart)
      const startTime = Math.max(currentTime, earliestStart);
      // The cast ends at castEnd
      const castEnd = startTime + skill.castTimeS;

      // If castEnd goes beyond the time limit, skip it
      if (castEnd > timeLimit) {
        continue;
      }

      // Then, after finishing, the next available time for skill i is:
      const oldNextAvail = nextAvailTimes[i];
      nextAvailTimes[i] = castEnd + effectiveRecast[i];

      // Add damage
      castSequence.push(skill.skillName);
      dfs(
        castEnd,                      // new "current time"
        totalDamageSoFar + skill.damage,
        nextAvailTimes,
        castSequence
      );

      // Backtrack
      castSequence.pop();
      nextAvailTimes[i] = oldNextAvail;
    }
  }

  // Initialize nextAvailTimes to 0 for all skills (all ready at t=0).
  const nextAvailTimes = skills.map(() => 0);
  dfs(0, 0, nextAvailTimes, []);

  return {
    totalDamage: bestDamageSoFar,
    sequence: bestSequenceSoFar
  };
}

// ----------------------------------
// 3. Combine: pick the best gear & schedule
// ----------------------------------
function findBestDpsSetup(
  skills: Skill[],
  timeLimit: number
): {
  bestDamage: number;
  bestDps: number;               // bestDamage / timeLimit
  chosenGearPercents: number[];
  castSequence: string[];
} {
  const allGearCombos = generateAllGearChoices(skills);

  let topDamage = 0;
  let topSequence: string[] = [];
  let bestGear: number[] = [];
  let bestGearCost = Number.POSITIVE_INFINITY;  // sum of gear % (tie-breaker)
  const totalCombos = allGearCombos.length;

  for (let i = 0; i < allGearCombos.length; i++) {
    const gearCombo = allGearCombos[i];
    console.log(`Evaluating gear combo ${i+1}/${totalCombos}:`, allGearCombos[i]);

    const { totalDamage, sequence } = findBestDamageSchedule(
      skills,
      gearCombo,
      timeLimit
    );

    if (totalDamage > topDamage) {
      // strictly better damage
      topDamage = totalDamage;
      topSequence = sequence;
      bestGear = gearCombo;
      bestGearCost = gearCombo.reduce((a, b) => a + b, 0);
    } else if (totalDamage === topDamage) {
      // tie => pick cheaper gear if it is cheaper
      const thisCost = gearCombo.reduce((a, b) => a + b, 0);
      if (thisCost < bestGearCost) {
        bestGear = gearCombo;
        bestGearCost = thisCost;
        topSequence = sequence; // same damage, new gear
      }
    }
  }

  const bestDps = topDamage / timeLimit;

  return {
    bestDamage: topDamage,
    bestDps,
    chosenGearPercents: bestGear,
    castSequence: topSequence
  };
}

// ----------------------------------
// Example Usage
// ----------------------------------
(function demo() {
  const skills: Skill[] = [
    {
      skillName: "Fireball",
      castTimeS: 1,
      recastTimeS: 6.7,
      damage: 10300,
      possibleSkillGear: [0, 15],
    },
    {
      skillName: "Fire Storm",
      castTimeS: 3,
      recastTimeS: 15,
      damage: 11100,
      possibleSkillGear: [0, 30],
    },
    {
      skillName: "Ice Blast",
      castTimeS: 4,
      recastTimeS: 20,
      damage: 14000,
      possibleSkillGear: [0],
    },
    {
      skillName: "Ice Shards",
      castTimeS: 2,
      recastTimeS: 15,
      damage: 11765,
      possibleSkillGear: [0, 30],
    },
    {
      skillName: "FrostBite",
      castTimeS: 3,
      recastTimeS: 20,
      damage: 9500,
      possibleSkillGear: [0],
    },
    {
      skillName: "Pet",
      castTimeS: 1,
      recastTimeS: 15,
      damage: 2400,
      possibleSkillGear: [0],
    },
    {
      skillName: "Offhand",
      castTimeS: 2,
      recastTimeS: 90,
      damage: 9000,
      possibleSkillGear: [0],
    },
    {
      skillName: "Mainhand",
      castTimeS: 1,
      recastTimeS: 45,
      damage: 9000,
      possibleSkillGear: [0],
    }
  ];

  // Example: We want to schedule up to 60 seconds to maximize total damage (thus maximizing DPS).
  const timeLimit = 60;
  const result = findBestDpsSetup(skills, timeLimit);

  console.log("=== Best DPS Setup ===");
  console.log("Gear chosen (%):", result.chosenGearPercents);
  console.log("Total Damage in", timeLimit, "s:", result.bestDamage);
  console.log("DPS:", result.bestDps.toFixed(2));
  console.log("Cast Sequence:", result.castSequence.join(" -> "));
})();
