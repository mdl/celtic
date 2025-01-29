#include <iostream>
#include <string>
#include <vector>
#include <cmath>
#include <limits>
#include <functional>
#include <algorithm>

using namespace std;

static const double EPS = 1e-9; // For floating-point comparisons

struct Skill {
    string skillName;
    double castTimeS;
    double recastTimeS;
    double damage;
    vector<double> possibleSkillGear;
};

struct ScheduleResult {
    double totalDamage;
    vector<string> sequence;
};

struct DpsResult {
    double bestDamage;
    double bestDps;
    vector<double> chosenGearPercents;
    vector<string> castSequence;
};

// 1) Generate all gear combinations (exactly 1 recast% pick per skill).
vector<vector<double>> generateAllGearChoices(const vector<Skill>& skills) {
    vector<vector<double>> results;
    vector<double> temp(skills.size());

    function<void(int)> backtrack = [&](int index) {
        if (index == (int)skills.size()) {
            results.push_back(temp);
            return;
        }
        for (double gearPercent : skills[index].possibleSkillGear) {
            temp[index] = gearPercent;
            backtrack(index + 1);
        }
    };

    backtrack(0);
    return results;
}

// 2) DFS to find max damage schedule, with progress logs
ScheduleResult findBestDamageSchedule(
    const vector<Skill>& skills,
    const vector<double>& gearCombo,
    double timeLimit
) {
    int n = (int)skills.size();
    // Effective recast times
    vector<double> effectiveRecast(n);
    for (int i = 0; i < n; i++) {
        double pct = gearCombo[i] / 100.0;
        effectiveRecast[i] = skills[i].recastTimeS * (1.0 - pct);
    }

    double bestDamageSoFar = 0.0;
    vector<string> bestSequenceSoFar;
    vector<double> nextAvail(n, 0.0);

    // Track how many DFS calls have been made, to show progress
    long long dfsCallCount = 0;

    function<void(double, double, vector<string>&)> dfs =
        [&](double currentTime, double totalDamage, vector<string>& castSequence) {
            // Increment DFS call count
            dfsCallCount++;
            // Print progress every 1000 calls (adjust threshold as needed)
//            if (dfsCallCount % 10000000 == 0) {
//                cout << "[DFS progress] calls: " << dfsCallCount
//                     << ", currentTime: " << currentTime
//                     << ", totalDamageSoFar: " << totalDamage << endl;
//            }

            // Update global best if needed
            if (totalDamage > bestDamageSoFar) {
                bestDamageSoFar = totalDamage;
                bestSequenceSoFar = castSequence;
            }

            // Try each skill as the next cast
            for (int i = 0; i < n; i++) {
                double earliestStart = nextAvail[i];
                if (earliestStart > timeLimit) {
                    continue;
                }

                double startTime = max(currentTime, earliestStart);
                double castEnd = startTime + skills[i].castTimeS;
                if (castEnd > timeLimit + EPS) {
                    continue;
                }

                double oldAvail = nextAvail[i];
                nextAvail[i] = castEnd + effectiveRecast[i];

                castSequence.push_back(skills[i].skillName);
                dfs(castEnd, totalDamage + skills[i].damage, castSequence);
                castSequence.pop_back();

                nextAvail[i] = oldAvail;
            }
        };

    vector<string> seq;
    dfs(0.0, 0.0, seq);

    return { bestDamageSoFar, bestSequenceSoFar };
}

// 3) For each gear combo, pick the highest totalDamage (tie -> cheapest gear), with progress log
DpsResult findBestDpsSetup(const vector<Skill>& skills, double timeLimit) {
    vector<vector<double>> allGearCombos = generateAllGearChoices(skills);

    double topDamage = 0.0;
    vector<string> topSequence;
    vector<double> bestGear;
    double bestGearCost = numeric_limits<double>::infinity();

    int totalCombos = (int)allGearCombos.size();

    for (int i = 0; i < totalCombos; i++) {
        // Print gear combo progress
        cout << "\n[Gear Combo Progress] Evaluating combo "
             << (i + 1) << "/" << totalCombos
             << " => [ ";
        for (double g : allGearCombos[i]) {
            cout << g << " ";
        }
        cout << "]" << endl;

        auto &gearCombo = allGearCombos[i];
        ScheduleResult sr = findBestDamageSchedule(skills, gearCombo, timeLimit);
        double comboDamage = sr.totalDamage;
        double comboCost = 0.0;
        for (double g : gearCombo) comboCost += g;

        if (comboDamage > topDamage) {
            topDamage = comboDamage;
            topSequence = sr.sequence;
            bestGear = gearCombo;
            bestGearCost = comboCost;
        } else if (fabs(comboDamage - topDamage) < EPS) {
            // tie => check gear cost
            if (comboCost < bestGearCost) {
                bestGear = gearCombo;
                bestGearCost = comboCost;
                topSequence = sr.sequence;
            }
        }
    }

    double bestDps = topDamage / timeLimit;
    return { topDamage, bestDps, bestGear, topSequence };
}

int main() {
    // Your actual skill config:
    vector<Skill> skills = {
        { "Fireball",   1,  6.7,   10300,  {15} },
        { "Fire Storm", 3,  15.0,  11100,  {30} },
        { "Ice Blast",  4,  20.0,  14000, {0} },
        { "Ice Shards", 2,  15.0,  11765, {30} },
        { "FrostBite",  3,  20.0,  9500,  {0} },
        { "Pet",        1,  15.0,  2400,  {0} },
        { "Offhand",    2,  90.0,  9000,  {0} },
        { "Mainhand",   1,  45.0,  9000,  {0} }
    };

    double timeLimit = 20.0; // 2 minutes
    DpsResult r = findBestDpsSetup(skills, timeLimit);

    cout << "\n=== Best DPS Setup (C++ version) ===" << endl;
    cout << "Time limit: " << timeLimit << " seconds" << endl;
    cout << "Total Damage: " << r.bestDamage << endl;
    cout << "DPS: " << r.bestDps << endl;

    cout << "Chosen Gear Percents: ";
    for (double g : r.chosenGearPercents) {
        cout << g << " ";
    }
    cout << endl;

    cout << "Cast Sequence:" << endl;
    for (auto & name : r.castSequence) {
        cout << name << " -> ";
    }
    cout << "END" << endl;

    return 0;
}
