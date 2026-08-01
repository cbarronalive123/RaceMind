# Behind the Scenes: Models View and the Agent-In-The-Loop Filter

## Problem

RaceMind runs four models that decide what the driver and the engineer see: a tread model that degrades the tyres, a fuel consumption model that burns the tank down, a TimesFM anomaly detector that searches the channel space for deviations, and a set of preventative rules that fire straight to the HUD.

Their parameters sit in `data/config/*.json` and their equations are inlined in `website/src/lib/simulation.ts`.
Nothing in the product shows that these models are running, what they take in, or what they are tuned to.

There is a second, less visible idea the product depends on and shows nowhere.
Every time an engineer approves, modifies or dismisses an anomaly, that is feedback.
Gemma condenses that feedback into logic - "exclude alerts with this tag", "limit alerts of this severity below this threshold on this channel" - and those rules become a final unsupervised filter on TimesFM output.
The system learns with every pass.

The internals section already anticipates a Models tab: `website/src/app/internals/layout.tsx` lists it as "soon".
This spec fills it in with both halves - the model roster and the feedback layer.

## Scope

In scope:

- An `/internals/models` view: a list on the left, a detail pane on the right.
- Four model entries, each showing its inputs, its parameters read live from `data/config/`, and a one-line activity strip showing it is running.
- A fifth entry, the Agent-In-The-Loop Filter, showing the feedback loop: engineer decisions, the Gemma prompt they feed, the rules that come out, and what those rules would suppress.
- A new `data/config/agent-filter.json` holding the prompt template, the seeded rules and the support threshold.

Out of scope:

- **Any actual suppression.** This is a demonstration of the layer, not a working filter. No alert is ever withheld from the Engineer Panel or the HUD.
- Any change to `website/server/`, `website/src/lib/protocol.ts` or `website/src/lib/simulation.ts`. The feature is additive and client-side.
- Real Gemma inference. The compile step is canned, and the view says so.
- Real TimesFM inference. It remains simulated, as `anomaly-detection.json` already states.
- Editing any model parameter. That belongs to the Config view.
- SLO target-versus-observed tables and model response curves. Considered and cut as more apparatus than the tab needs.

## Approach

### Route and shell

`website/src/app/internals/models/page.tsx` renders `<ModelsView />`.
The Models entry in the `TABS` array in `website/src/app/internals/layout.tsx` flips to `ready: true`.

Two panes inside the existing non-scrolling internals shell.
The left rail lists five entries: the four models, then a separated fifth for the Agent-In-The-Loop Filter, which is not a model but the layer that learns from what the engineer does to their output.
The right pane shows the selection and scrolls on its own.
The page never scrolls as a whole, matching the discipline the Explore view established.

### The pipeline

The filter pane leads with the loop it belongs to, drawn inline:

```
TimesFM raises candidates  ->  Agent-In-The-Loop Filter  ->  Engineer Panel
   (searching the space)         (learned suppression)      approve/modify/dismiss
              ^                                                      |
              +-------------- every decision teaches it -------------+
```

### Model entries

Each of the four models shows three things and nothing more.

**Summary.** One paragraph: what it does, what it is for, where it is implemented.

**Inputs and parameters.** A grouped table, every value read from `@data/config/*` through the existing path alias. No value is retyped into the view by hand.

| Model | Inputs | Parameters |
| --- | --- | --- |
| Tread | lateral g, speed, compound, track temperature | base wear rate, lateral and speed coefficients, thermal coefficient, grip cliff, grip floor, per-compound `wear_factor` and `expected_life_laps` |
| Fuel consumption | speed, longitudinal g, lateral g, compound, wind, rain | idle, drag, acceleration and cornering terms, flow ceiling, wind and rain factors, per-compound `fuel_factor` |
| TimesFM, shown as "Optimization Explorer" | recent channel history, sensitivity | the three sigma levels with the selected one marked, `check_interval_s`, enabled flag, the four anomaly templates |
| Rules | lap counter, the channels named by the triggers | the six rules: trigger type, channel, operator, threshold, `cooldown_laps`, severity, enabled |

The constants that live in `simulation.ts` rather than in config are referenced there by file and line, so the view points at its own implementation.

**Activity strip.** One line establishing the model is running in the background rather than sitting in a document: its evaluation rate, what it is scanning, and how many candidates it has produced this session.
Values come from data the store already holds - the frame stream and `telemetry.alerts`.
Before a race connects the strip reads "idle - no race data" rather than zeros, which would read as a measurement of a running model.

### The Agent-In-The-Loop Filter

The pane has four sections. The purpose of the arrangement is that no step is a black box: a rule can be traced back through the decisions that produced it and the prompt that framed them.

**1. Decision feed.**
The engineer actions that constitute the feedback, newest first, read from the `status` field on 2c alerts in the store: `sent` for approved, `sent` with a changed message for modified, `dismissed` for dismissed.
Each row shows the alert, the lap, the action, and what the filter took from it - including "no rule derived", so the misses are as visible as the hits.

**2. The prompt.**
The Gemma prompt template from `agent-filter.json`, rendered verbatim with the live decision history interpolated into it.
This is the feedback prompt itself, shown rather than described.
The pane states plainly that the call is canned and no model is invoked.

**3. Derived rules.**
Collapsed, each rule shows its plain-English statement, its support count and how many alerts it would have suppressed.
A rule needs `support_threshold` decisions behind it before it is considered active, so rules below the threshold are visible in a proposed state - the learning is watchable rather than instantaneous.

Expanded, a rule shows everything behind it:

```json
{
  "id": "supp-brake-low-sigma",
  "statement": "Brake temp anomalies below 3.0 sigma are not worth surfacing.",
  "predicate": { "channel": "brake_temp_*", "sigma": { "<": 3.0 } },
  "action": "suppress",
  "support": [{ "alertId": "a-14", "lap": 12, "decision": "dismissed" }],
  "confidence": 0.8,
  "enabled": true,
  "wouldSuppress": 4
}
```

The `support` array is the evidence: the specific decisions that produced the rule, each naming its alert and lap.
Rule kinds cover the shapes named in the feature request - exclude by tag, limit by severity, and threshold on a channel.

**4. Effect, clearly hypothetical.**
A list of the alerts the active rules would have suppressed, labelled as would-have.
Nothing is withheld anywhere in the product.
The section header and every count in it carry that framing, so the demonstration cannot be mistaken for a working filter.

### The canned Gemma compile

`website/src/lib/models/filter.ts` exports a pure function from decision history to rule set.
It recognises a fixed catalogue of rule shapes declared in `agent-filter.json` - repeated dismissals of a channel below a sigma level, repeated dismissals of a severity, repeated dismissals sharing a template tag - and emits the corresponding rule with the decisions that support it.

It is deterministic, needs no network, and works offline in a demo.
It is labelled as a stub in the view, consistent with how TimesFM is already handled.
The prompt shown in section 2 is the real prompt that would be sent if the call were live, so replacing the stub later does not change what the pane displays.

`agent-filter.json` also carries seeded rules, so the pane is populated and legible before any engineer decision has been made in the current session.
Seeded rules are marked as such and are visually distinct from rules derived from live decisions.

## File changes

| File | Change |
| --- | --- |
| `data/config/agent-filter.json` | new - prompt template, rule catalogue, support threshold, seeded rules |
| `website/src/lib/models/registry.ts` | new - the four model descriptors |
| `website/src/lib/models/filter.ts` | new - canned compile from decisions to rules |
| `website/src/lib/models/activity.ts` | new - activity strip values from store data |
| `website/src/components/internals/models/ModelsView.tsx` | new - two-pane shell, selection state |
| `website/src/components/internals/models/ModelList.tsx` | new - left rail |
| `website/src/components/internals/models/ModelDetail.tsx` | new - renders one model descriptor |
| `website/src/components/internals/models/ParameterTable.tsx` | new - grouped value rows |
| `website/src/components/internals/models/ActivityStrip.tsx` | new |
| `website/src/components/internals/models/FilterPane.tsx` | new - the four filter sections |
| `website/src/components/internals/models/RuleCard.tsx` | new - collapsed and expanded rule |
| `website/src/app/internals/models/page.tsx` | new - route |
| `website/src/app/internals/layout.tsx` | edit - Models tab `ready: true` |

Every change is additive except the one-word edit to `layout.tsx`.
No server, protocol or simulation file is touched, so no existing behaviour can regress.

## Verification

- `npm run lint` and `npm run typecheck` clean.
- `npm run dev:all`, open `/internals/models`, and confirm each model's parameters match its config file.
- Confirm the activity strips populate with a race running and read "idle" before one connects.
- On the Pit Wall, dismiss two brake-temp anomalies, then confirm the filter pane's decision feed shows both and a proposed rule appears with those two decisions as its support.
- Confirm every rule expands to its supporting decisions and that the prompt section shows the live decision history.
- Confirm no alert is ever withheld: the Engineer Panel and HUD queues carry the same alerts whether or not a rule claims it would suppress them.
