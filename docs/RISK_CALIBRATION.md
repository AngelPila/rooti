# Crop loss risk calibration

Rooti can adjust the ranking of rice and maize planting dates using L2 regularized logistic regression. The target is whether an observed planting lost **at least half** of its reference harvest. The historical calendar, simulated yield and historical failure counts continue to show the agronomic simulation. The additional probability is an estimate for a planting, averaged over the weather scenarios, and does not represent the probability that a whole farm loses its harvest.

## Observed records

Supply a JSON Lines file with one verified, completed planting per line. Keep the file outside the repository and the public `app/` folder. Use pseudonymous identifiers that stay stable across campaigns. Include successful plantings and total losses. Keep the protocol used to estimate each planting's reference harvest consistent and documented. Opening a plan, choosing a proposal or posting in Vecinos does not count as an observed outcome.

| Field | Meaning |
|---|---|
| `farmId`, `plotId` | Stable farm and plot identifiers, as strings. |
| `lat`, `lon` | Field coordinates, within 15 km of the Daule, Babahoyo or Quevedo pilot centers. |
| `crop` | `rice` or `maize`. |
| `sown`, `observedOn` | Actual sowing date and date the outcome was recorded, formatted `YYYY-MM-DD`. Include the date on which a total loss was confirmed if nothing was harvested. The year of `observedOn` identifies the campaign for validation. |
| `irrigation` | Boolean for whether supplemental irrigation was available and used to cover deficits, consistent with the simulator. |
| `lossShare` | Observed fraction of harvest lost, from 0 to 1, against a documented reference for the cultivar and management. |
| `site.awc`, `site.ph`, `site.wl` | Root-zone available water capacity (mm), pH and relative waterlogging susceptibility (0–1). Use measurements or the same [`describeSoil` and `waterlogFactor`](../app/terrain.js) rules as Rooti. |

## Training and applying the model

Run from the repository root with Node.js 22 or newer and network access to NASA POWER:

```sh
node pipeline/train-risk.mjs /path/to/observed-harvests.jsonl app/data/risk-model.json
```

The script fetches each point's daily NASA weather using Rooti's climate loader and replays the planting from its sowing month. The inputs are the simulator's yield shortfall, water deficit, ponding and temperature penalties, plus irrigation, cyclical sowing month, crop and pilot area. A planting that the simulator marks as a complete failure retains a risk of 100%. The other cases train a model with standardized features, an unpenalized intercept, an L2 penalty of `0.05` on its weights and up to `3000` gradient steps (gradient tolerance `1e-7`). The month alignment is the same approximation the calculator uses in plans.

The latest campaign is held out. Only outcomes recorded before the first held-out sowing and from farms outside that campaign's test set can train the model. Each eligible crop and area requires at least 30 training cases outside the complete-failure rule, with at least five of each outcome, and at least 10 held-out cases with at least two of each outcome. The script writes an artifact only if at least one crop and area beats both the simulator's severe-loss flag and the historic training loss rate on held-out Brier score. These are pilot gates. Wider use requires more independent field validation.

The repository ships an `untrained` status file. After a successful run, review the metrics and deploy the generated artifact with the app. The web and bot planners use only validated cohorts with complete daily scenario data and a known soil pH. If a plan mixes calibrated and uncalibrated crops, the optimizer ranks both using the same severe-loss event, with simulated severe-loss frequency for the uncalibrated candidates. In **My plan → open a plan → See the full reasoning**, Rooti shows the source of the risk estimate and, when the adjustment applies, its value and coverage. Tap a planting in the calendar to see its own risk. **Compare** shows the adjusted risk in each supported calendar. The original historical metrics remain available. Retraining is a deliberate operation after new field observations become available.
