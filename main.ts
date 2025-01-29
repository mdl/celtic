import { MinPriorityQueue } from '@datastructures-js/priority-queue';
import { Queue } from '@datastructures-js/queue';

interface Skill {
  skillName: string;
  castTimeS: number;           // How long it takes to cast
  recastTimeS: number;         // Base cooldown after finishing
  damage: number;              // How much damage one cast does
  possibleSkillGear: number[]; // e.g. [0, 10, 30] => recast can be reduced by 0%, 10%, or 30%
}

interface ScheduleResult {
  totalDamage: number;
  sequence: string[];
}

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

function findBestDamageSchedule(
  skills: Skill[],
  gearCombo: number[],
  timeLimit: number
): ScheduleResult {
  // 1) Precompute effective recast times
  const effectiveRecast = skills.map((skill, i) => {
    const pct = gearCombo[i] / 100;
    return skill.recastTimeS * (1 - pct);
  });

  interface State {
    currentTime: number;
    damageSoFar: number;
    nextAvail: number[];
    castSequence: string[];
  }

  // 2) The BFS queue
  const queue = new Queue<State>();
  const initial: State = {
    currentTime: 0,
    damageSoFar: 0,
    nextAvail: skills.map(() => 0),
    castSequence: []
  };
  queue.enqueue(initial);

  // 3) We'll keep track of only the top 1000 states per time checkpoint
  //    using a dictionary: checkpoint => MinPriorityQueue of states
  //    with priority = damageSoFar (lowest is popped first).
  const topStatesPerCheckpoint: Record<number, MinPriorityQueue<State>> = {};

  function ensureQueueForCheckpoint(cp: number) {
    if (!topStatesPerCheckpoint[cp]) {
      topStatesPerCheckpoint[cp] = new MinPriorityQueue<State>((state) => state.damageSoFar);
    }
  }

  // 4) Global best tracking
  let bestDamage = 0;
  let bestSequence: string[] = [];

  let expansions = 0;

  // 5) BFS
  while (!queue.isEmpty()) {
    const state = queue.dequeue();
    expansions++;

    // // Log progress occasionally
    // if (expansions % 5000000 === 0) {
    //   console.log(`[${state.currentTime.toFixed(2)}s] expansions=${expansions}, queueSize=${queue.size()}, bestDamage=${bestDamage}`);
    // }

    // Update global best
    if (state.damageSoFar > bestDamage) {
      bestDamage = state.damageSoFar;
      bestSequence = state.castSequence.slice();
    }

    // Expand all skills from this state
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i];
      const earliestStart = state.nextAvail[i];
      if (earliestStart > timeLimit) continue;

      const startTime = Math.max(state.currentTime, earliestStart);
      const castEnd = startTime + skill.castTimeS;
      if (castEnd > timeLimit) continue;

      const newDamage = state.damageSoFar + skill.damage;

      const newNextAvail = [...state.nextAvail];
      newNextAvail[i] = castEnd + effectiveRecast[i];

      const newSequence = [...state.castSequence, skill.skillName];

      const newState: State = {
        currentTime: castEnd,
        damageSoFar: newDamage,
        nextAvail: newNextAvail,
        castSequence: newSequence
      };

      // --- Determine the checkpoint bucket
      // You might choose 5-second increments. We'll do 5s here:
      const checkpoint = Math.floor(castEnd / 5) * 5;

      // Make sure we have a min-heap for this checkpoint
      ensureQueueForCheckpoint(checkpoint);

      const heap = topStatesPerCheckpoint[checkpoint];

      // If there's space in this heap (< 1000), or we beat the min in the heap, we keep it.
      if (heap.size() < 10000) {
        heap.enqueue(newState);
        queue.enqueue(newState);
      } else {
        // Check the worst (min damage) in the top-1000
        const worstTopState = heap.front(); // min item
        if (worstTopState && newDamage > worstTopState.damageSoFar) {
          // we are better => pop the old min, push new
          heap.dequeue();
          heap.enqueue(newState);

          // Also push to BFS queue
          queue.enqueue(newState);
        }
        // else we do nothing => prune
      }
    }
  }

  // 6) Return final best
  return {
    totalDamage: bestDamage,
    sequence: bestSequence
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

    console.log()
    console.log("===DPS Setup ===");
    console.log("Gear chosen (%):", gearCombo);
    console.log("Total Damage in", timeLimit, "s:", totalDamage);
    console.log("Cast Sequence:", sequence.join(" -> "));
    console.log()
    console.log()
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
      possibleSkillGear: [0, 15, 20, 25, 30],
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
      possibleSkillGear: [0, 30],
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
  findBestDpsSetup(skills, timeLimit);
})();
