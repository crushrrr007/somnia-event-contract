# SignalSprint V2: Reason Duel + Scheduled Coach

Last updated: 2026-08-31 (Asia/Kolkata)

## 0. Authority and handoff rule

[VERIFIED] This file is the authoritative product and execution plan for the SignalSprint pivot from 2026-08-31 onward.

[VERIFIED] `WINNING_PROJECT_PLAN.md` remains the implementation history and evidence ledger for the already-built DreamDEX trading, history, settlement, redemption, and replay flows.

[INFERRED] Future models must preserve the proven trading infrastructure and replace the wrapper-like product experience with the learning-duel loop defined here.

[INFERRED] Do not add a pooled pot, custom token, NFT, autonomous trader, copy-trading feature, generic chatbot, or profit leaderboard unless the user explicitly changes this plan.

## 1. Goal and acceptance criteria

### Goal

[INFERRED] Turn every simple DreamDEX UP/DOWN market into a beginner lesson with a social commitment: the user makes a real bounded call, explains why, challenges a friend or benchmark, and receives a settlement-triggered coaching result before the next round.

### One-line product definition

[INFERRED] **SignalSprint is a reason duel: choose UP or DOWN, lock why you believe it, back the call with a small DreamDEX testnet position, then learn from the result when the market settles.**

### Final acceptance criteria

- [ ] **AC1 - Zero-wallet lesson:** A first-time visitor understands UP, DOWN, price-as-probability, and maximum loss through a sub-60-second interactive rehearsal before any wallet prompt.
- [ ] **AC2 - Reason commitment:** Before trading, a player chooses a side, one bounded reason card, confidence, and maximum loss; these inputs are immutable for that round after commitment.
- [ ] **AC3 - Real sponsor action:** Each backed call is linked to a confirmed DreamDEX Event Contract fill and records `marketId`, side, fill, cost, quantity, wallet, and transaction evidence.
- [ ] **AC4 - No pooled custody:** Each player owns and redeems their own DreamDEX position; SignalSprint never escrows duel funds or holds a user private key.
- [ ] **AC5 - Fair duel:** Both players use the same `marketId`; calls close before a visible cutoff; no-fill rounds are no-contest; voided markets have no winner.
- [ ] **AC6 - Scheduled referee:** A long-running worker detects settlement from chain-backed market status and creates a result without requiring either player to keep the browser open.
- [ ] **AC7 - Useful lesson:** The result distinguishes direction, entry price, confidence calibration, and process instead of reducing the round to profit or loss.
- [ ] **AC8 - Return loop:** The user has a persistent Coach Inbox and can start a rematch in the next eligible window from the settled result.
- [ ] **AC9 - Proof:** The demo exposes market, trade, settlement, and redemption evidence without forcing beginner users to read chain terminology during the main flow.
- [ ] **AC10 - Submission:** The deployed prototype, public repository, README, 2-3 minute demo, verified transactions, and rubric mapping are complete before the internal deadline.

## 2. Why this is the pivot

### Problem with the current product

[VERIFIED] The current app already discovers live markets, connects a wallet, submits bounded IOC orders with finite approvals, reconstructs wallet history, checks settlement, redeems eligible positions, scores decisions, and replays a deterministic round.

[INFERRED] Those capabilities prove technical integration but currently feel like a safer DreamDEX wrapper because the user still performs the same primary action and receives only a richer receipt.

### Competitive gap

[VERIFIED] Existing products already combine simple UP/DOWN predictions with education, streaks, rankings, social calls, or head-to-head challenges; examples found during recon include UpOrDown, Daily Dow, DuelDuck, PredictDuel, Foretold, and ResoMarket.

[VERIFIED] A current hackathon competitor, PredicTrader AI, publicly presents an AI oracle sentinel and social copy-trading flow.

[VERIFIED] Previous-winner research supplied for this project found that strong submissions make the sponsor primitive cause a visible human consequence instead of presenting a generic dashboard.

[INFERRED] A basic duel, Elo board, AI signal, or gamified skin would remain crowded. The defensible experience is the combination of **reason commitment + real trade proof + settlement-triggered teaching + immediate rematch**.

### Sponsor-essential test

[INFERRED] Removing DreamDEX breaks the product: no executable probability, immutable trade commitment, market lifecycle, settlement truth, payout evidence, or repeatable short-window lesson remains.

## 3. Concepts considered

[VERIFIED] Scores use the published judging weights already recorded in `WINNING_PROJECT_PLAN.md`: Technical 25%, Innovation 20%, UX 20%, Business/Ecosystem 20%, Presentation 15%.

[INFERRED] Scores are planning estimates, not judge predictions.

| Concept | Technical | Innovation | UX | Business | Presentation | Weighted /5 | Feasibility | Differentiation |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Guided Solo Sprint | 4.3 | 3.4 | 4.7 | 4.1 | 4.5 | 4.18 | 5.0 | 3.0 |
| Friend Countercall | 4.5 | 3.6 | 4.7 | 4.5 | 4.8 | 4.40 | 4.5 | 3.0 |
| **Reason Duel + Scheduled Coach** | **4.7** | **4.7** | **4.8** | **4.6** | **5.0** | **4.75** | **4.0** | **5.0** |
| Human vs Shadow Coach | 4.6 | 4.2 | 4.6 | 4.2 | 4.7 | 4.45 | 3.5 | 3.5 |
| Full Learning League | 4.9 | 4.8 | 4.6 | 4.8 | 4.9 | 4.80 | 2.5 | 5.0 |

[INFERRED] Build Reason Duel + Scheduled Coach. It captures most of the Learning League's judge-visible novelty without requiring a large curriculum, matchmaking system, token economy, or generalized social graph.

## 4. Core experience

### Product loop

`learn -> choose -> explain -> cap risk -> commit -> compare -> settle -> coach -> rematch`

### Step 1: Learn without a wallet

[INFERRED] The landing screen starts with one animated market line: **UP wins if close >= open; DOWN wins if close < open**.

[INFERRED] The visitor answers one rehearsal question using fake units. The interface then reveals the outcome and explains that a 64-cent outcome contract costs 0.64 units and pays 1 unit if correct.

[INFERRED] The wallet prompt appears only after the visitor completes or skips the rehearsal.

### Step 2: Make a reasoned call

[INFERRED] The call composer asks four questions in order:

1. `UP or DOWN?`
2. `Why?` using one reason card.
3. `How sure are you?` using three confidence bands rather than a precise-looking slider.
4. `What is the most you can lose?` using a small testnet risk control.

### Step 3: Select the challenge mode

[INFERRED] Ship three modes in this order:

1. **Solo lesson:** The user commits and receives a scheduled postmortem.
2. **Challenge a friend:** A share link lets a second wallet lock a call on the same market.
3. **Challenge the benchmark:** A deterministic read-only benchmark creates a comparison card; it never trades, promises profit, or presents itself as financial advice.

[INFERRED] Solo mode guarantees every user can finish the learning loop; friend mode supplies the social demo moment; benchmark mode prevents an empty experience when no friend is available.

### Step 4: Back the call

[VERIFIED] The existing app already supports browser-wallet signing, exact finite token approval, a post-approval re-quote, bounded IOC execution, fill confirmation, and transaction evidence.

[INFERRED] Reuse that flow behind a beginner-facing button labeled `Back this call`; keep orderbook, allowance, and transaction details inside an optional `Proof` drawer.

### Step 5: Reveal and wait

[INFERRED] In a friend duel, the creator's side and reason stay hidden in the SignalSprint UI until the opponent commits or the challenge closes.

[VERIFIED] The underlying DreamDEX trade is public on-chain, so MVP hiding is a UX anti-copy measure, not cryptographic secrecy.

[INFERRED] The waiting state shows market progress, both trade-confirmation states, settlement timing, and the exact condition that produces no contest.

### Step 6: Settlement becomes a lesson

[INFERRED] The result card must answer four questions in plain language:

1. **Direction:** Was the chosen side the settled winner?
2. **Entry:** How much did the player pay for a 1-unit potential payout?
3. **Confidence:** Was the confidence band consistent with the outcome over repeated completed rounds?
4. **Process:** Which observable fact supported or contradicted the selected reason?

[INFERRED] Example result: `Correct direction, expensive entry. You paid 0.82 per contract, so the market had already priced UP as likely. Next lesson: probability is not the same as value.`

[INFERRED] Never claim that one result proves skill, edge, causation, or a profitable strategy.

### Step 7: Follow up and rematch

[INFERRED] The scheduled result appears in a persistent Coach Inbox even if the user closed the original round.

[INFERRED] The primary result action is `Use this lesson in the next window`, which preselects the next eligible market but never preselects UP or DOWN.

[INFERRED] A friend result also provides `Rematch` and a shareable proof card with no wallet balance or sensitive metadata.

## 5. Duel rules

### Financial model

[INFERRED] There is no duel pot and no transfer between players.

[INFERRED] Each player chooses their own bounded DreamDEX position, keeps their own market P&L, and separately redeems any claimable outcome.

[INFERRED] Duel rewards are learning progress, completed lessons, and rematch continuity; they are not a token, cash prize, or NFT.

### Eligibility

- [INFERRED] Both entries must reference the same `marketId`.
- [INFERRED] Each player must have a confirmed non-zero fill before the challenge cutoff.
- [INFERRED] The cutoff must leave the existing minimum expiry headroom and display the remaining join time.
- [INFERRED] Position sizes may differ; the duel compares decision quality, not absolute profit.
- [INFERRED] If only one player fills, the round becomes a solo lesson rather than awarding a duel win.
- [INFERRED] If the market is voided, the duel records `VOID - NO CONTEST` and teaches the void/redemption path.
- [INFERRED] If chain-backed settlement is unavailable, the worker keeps the round pending and does not infer an outcome from price text or question text.

### Winner presentation

[INFERRED] The settled direction determines the round winner; the lesson score is presented separately so a correct call with poor entry discipline is not portrayed as perfect judgment.

[INFERRED] Do not collapse direction, confidence, and entry into one unexplained number. Show the dimensions first; an aggregate learning score may be added only after user testing.

### Anti-copy limitation

[VERIFIED] Any public on-chain trade can be inspected before the UI reveal.

[INFERRED] MVP therefore promises a convenient hidden challenge, not cryptographic commit-reveal. A custom on-chain commitment contract is out of scope unless judges demonstrate that adversarial secrecy is necessary.

## 6. Beginner curriculum

### Release curriculum

[INFERRED] Teach only three concepts in the first release:

1. **Direction:** How opening price and closing price decide UP/DOWN.
2. **Probability as price:** Why a correct direction can still be an expensive trade.
3. **Bounded risk:** Cost, maximum loss, potential payout, and why position size matters.

[INFERRED] Timing, order types, liquidity, calibration curves, and advanced strategy become follow-on modules after the core loop is proven.

### Reason cards

[INFERRED] Use a fixed taxonomy that can be scored without an LLM:

| Reason code | Beginner label | Evidence captured at commitment | Lesson boundary |
|---|---|---|---|
| `ABOVE_OPEN` | Price is above the opening line | current underlying versus opening reference | Describes current position, not future certainty |
| `MOMENTUM` | The move looks strong | recent underlying movement over a fixed visible interval | One move does not prove continuation |
| `REVERSAL` | The move looks stretched | distance from opening reference and time remaining | A stretched move may continue |
| `MARKET_ODDS` | The contract price looks mispriced | best executable price and opposite-side price | Price is crowd probability, not guaranteed truth |
| `INSTINCT` | I am practicing a hunch | no analytical evidence | Useful baseline for comparing later discipline |

[ASSUMED] Exact lookback intervals and thresholds require validation against available DreamDEX/underlying data before implementation; do not invent them during UI work.

### Confidence

[INFERRED] Use `Exploring`, `Leaning`, and `Strong view` rather than asking beginners for an artificial exact percentage.

[INFERRED] Calibration coaching activates only after enough settled rounds to compare a band across repeated outcomes; before that, show descriptive history without a skill claim.

### Progression

[INFERRED] Progress is based on completing the loop and applying concepts, not winning money:

- Lesson 1 unlock: complete a settled direction round.
- Lesson 2 unlock: explain price-as-probability on the result card.
- Lesson 3 unlock: complete a round within a self-selected maximum-loss cap.
- Duel badge: finish a no-pot friend challenge with both trades verified.

## 7. Scheduled Coach and DreamBot contribution

### Verified DreamDEX tooling

- [VERIFIED] The project has `@somnia-chain/markets-sdk@0.28.1` installed, verified from `node_modules/@somnia-chain/markets-sdk/package.json`.
- [VERIFIED] Official Event Contract docs expose live discovery, orderbook/fill/candle reads, trading, mint/merge, and redemption through the TypeScript SDK; the HTTP API is documented as spot-only.
- [VERIFIED] The official `somnia-chain/dreamdex-bot-kit` source was inspected at commit `dccd2fdbf5e59316a5e9209546707b91b5f4cd7d` dated 2026-08-24.
- [VERIFIED] Its Event Contract package `@dreamdex-bot-kit/ec-core` is version `0.1.0` in the repository and depends on `@somnia-chain/markets-sdk` `^0.28.1`; it is not currently installed in SignalSprint.
- [VERIFIED] The bot kit contains `ec-starter`, `ec-maker`, `ec-passive`, `ec-settlement`, `ec-oracle-follow`, and `ec-laddering-bot` strategies.
- [VERIFIED] The Railway launcher allow-list contains all six `ec-*` strategies, and official bot-kit docs describe setting `STRATEGY=ec-settlement` for an always-on worker.
- [VERIFIED] `ec-settlement` polls a market lifecycle, detects resolved or voided status, and can sweep settled positions for redemption.
- [VERIFIED] Event Contract strategy loops serialize claims with trading writes to reduce nonce races; on-chain market status and transaction receipts remain the truth.
- [VERIFIED] A targeted source scan found no user-facing email, Telegram, Discord, webhook, browser-push, or notification implementation in the Event Contract core, strategies, or deployment docs.

### What to reuse

[INFERRED] Reuse bot-kit patterns, not its autonomous trading product:

- Market lifecycle polling keyed by `marketId`.
- Finalized/voided discovery and retry behavior.
- Always-on Railway worker deployment pattern.
- Dry-run-first operations, heartbeats, reconnect handling, and receipt checks.
- Indexer-lag caution and chain-backed reconciliation.

### What not to reuse

[INFERRED] Do not let a platform worker hold user keys, place user trades, redeem user positions, or race browser-wallet writes.

[INFERRED] Do not ship the `ec-oracle-follow` trading strategy as a prediction feature. Its own documentation describes the signal as a placeholder whose edge is questionable; a competing AI-oracle project already occupies that narrative.

[INFERRED] `ec-maker`, `ec-laddering-bot`, and `ec-passive` are useful developer examples but are not part of the beginner MVP.

### Scheduled Coach worker

[INFERRED] Build a read-only referee service using the `ec-settlement` lifecycle pattern:

1. Find active challenge records whose `marketId` is approaching or past expiry.
2. Read chain-backed market status.
3. If still Trading or Locked, schedule the next check with bounded retry/backoff.
4. If Resolved, record the winning outcome and settlement evidence.
5. If Voided, record no contest and the void lesson.
6. Reconcile both submitted trade receipts and fills.
7. Run the deterministic lesson rules.
8. create one Coach Inbox item per player.
9. Mark the challenge complete idempotently.

[INFERRED] Settlement status, not a fixed clock, triggers the lesson; a scheduler only determines when to check again.

[INFERRED] The worker requires no private key for read-only settlement coaching. Redemption remains an explicit browser-wallet action in the existing app.

### DreamBot Builder boundary

[VERIFIED] Bot-kit documentation says DreamBot Builder generates a Railway-ready environment block for strategy deployment, while the Railway service runs as a worker with no public HTTP endpoint.

[VERIFIED] The repository can launch `ec-settlement` through its Railway strategy allow-list.

[ASSUMED] The currently deployed Builder UI's exact Event Contract options and support for a custom SignalSprint referee were not verified from the dynamic page.

[INFERRED] Use the official Builder/kit deployment flow to demonstrate sponsor-aligned bot operations if it can select `ec-settlement`; implement SignalSprint-specific persistence, lesson generation, and inbox delivery in our own worker because those capabilities are absent from the verified kit source.

## 8. System architecture

```text
Beginner browser
  rehearsal -> reason card -> wallet-signed DreamDEX trade
       |                         |
       | challenge metadata      | transaction + fill evidence
       v                         v
Challenge service <-------- DreamDEX / Somnia
       |
       | active marketId records
       v
Scheduled Coach worker
  status -> settlement -> deterministic lesson -> inbox result
       |
       v
Coach Inbox -> result proof -> user-signed redemption -> rematch
```

### Trust boundaries

- [VERIFIED] User trade and redemption signatures remain in the browser wallet in the current implementation.
- [INFERRED] The service stores challenge and learning metadata but cannot move user funds.
- [INFERRED] Chain data proves the trade and outcome; the service supplies coordination and coaching.
- [INFERRED] Every result must retain transaction and market evidence so a service bug is auditable.

### Persistence requirement

[VERIFIED] Browser-local state alone cannot coordinate two wallets or generate a result after both users close the app.

[INFERRED] V2 therefore needs a small persistent challenge service and an always-on settlement worker.

[ASSUMED] The database/hosting provider is intentionally unselected. It must be verified against deployment limits, SDK/API docs, and hackathon time before any dependency, environment variable, or API call is written.

### Minimum record model

[INFERRED] Persist these logical fields; exact database syntax is deferred until the provider is verified:

| Record | Required fields |
|---|---|
| Challenge | id, marketId, creator wallet, opponent wallet if joined, mode, status, join cutoff, created time |
| Commitment | wallet, side, reason code, confidence band, max-loss cap, commitment time |
| Market snapshot | marketId, lifecycle status, expiry, executable outcome prices, opening reference, current reference, captured time |
| Trade proof | wallet, transaction hash, side, filled quantity, average fill, cost, receipt status |
| Settlement | lifecycle status, winning outcome or void, settlement evidence, checked time |
| Lesson | direction result, entry message, confidence message, process message, next lesson, generated version |
| Inbox item | wallet, challenge id, result status, unread state, created time |

### Idempotency and consistency

- [INFERRED] Challenge completion must be idempotent so retries cannot create duplicate lessons.
- [INFERRED] Trade proof is accepted only after a successful receipt and a fill reconciled to the wallet, market, and side.
- [INFERRED] The worker may tolerate delayed indexer data but may never replace chain-backed lifecycle status with an inferred result.
- [INFERRED] A changed or recycled pool address must not merge rounds; `marketId` remains the logical identity.

## 9. Deterministic coaching engine

### Rule inputs

[INFERRED] Use only captured facts: side, reason code, confidence band, maximum-loss choice, pre-trade executable price, confirmed fill, opening reference, expiry, final outcome, and prior settled lesson history.

### Rule outputs

[INFERRED] The engine returns a fixed schema:

- Headline: one sentence.
- Direction: correct, incorrect, void, or unresolved.
- Entry: cheap, middle, or expensive relative to payout using explicit thresholds.
- Confidence: descriptive until a minimum history gate is reached.
- Process: one reason-specific observation.
- Next concept: exactly one lesson.
- Evidence: market and transaction references.

### Safety and honesty

- [INFERRED] Do not generate buy/sell recommendations.
- [INFERRED] Do not call a user skilled or unskilled from one result.
- [INFERRED] Do not claim a reason caused the outcome.
- [INFERRED] Do not use an LLM in the critical result path; deterministic rules make the demo repeatable and auditable.
- [INFERRED] If an LLM explanation is added later, it may paraphrase a verified rule output but cannot change scores, settlement, or next actions.

## 10. UI direction

### Main navigation

[INFERRED] Use four product destinations:

1. `Learn` - zero-wallet rehearsal and unlocked concepts.
2. `Play` - live market call composer.
3. `Duels` - active, waiting, settled, and rematchable challenges.
4. `Coach Inbox` - scheduled results and next lessons.

### Progressive disclosure

[INFERRED] Beginner mode shows opening line, current position, time remaining, outcome cost, maximum loss, and potential payout.

[INFERRED] A `Proof` drawer shows `marketId`, lifecycle, order details, fill evidence, transaction hash, settlement, and redemption for judges and advanced users.

### Required states

- Visitor rehearsal.
- Wallet absent or wrong chain.
- Live market available.
- Market too close to expiry.
- Challenge waiting for opponent.
- Opponent committed and reveal available.
- One trade filled and one failed.
- Market locked and worker pending.
- Resolved result.
- Voided/no-contest result.
- Claimable and redeemed result.
- Coach Inbox empty, loading, error, unread, and read.

## 11. Generic-project kill list

- [INFERRED] No chat interface as the primary experience.
- [INFERRED] No autonomous AI trader or magic oracle.
- [INFERRED] No copy trading.
- [INFERRED] No pooled duel pot or escrow contract.
- [INFERRED] No generic Elo/profit leaderboard in MVP.
- [INFERRED] No token, NFT, or badge that exists only for decoration.
- [INFERRED] No fake portfolio pretending to be live integration.
- [INFERRED] No game skin whose state is disconnected from DreamDEX settlement.
- [INFERRED] No claim that testnet lessons establish real-money profitability.

## 12. Delivery phases

[ASSUMED] Estimates assume one focused builder and reuse of the existing proven code. Re-estimate after Phase 0 verifies the persistence provider and available hours.

### Phase 0 - Decision gates (2-3 hours)

- [ ] Verify the current event deadline/timezone and mandatory feedback-report status from the primary DoraHacks page.
- [ ] Verify the current DreamBot Builder UI and whether it exposes `ec-settlement` directly.
- [ ] Select and document one persistence/hosting path after checking official docs and project compatibility.
- [ ] Select MVP delivery as in-app inbox; treat email, Telegram, Discord, or browser push as stretch until their providers are verified.
- [ ] Freeze the reason taxonomy, confidence bands, no-contest rules, and 24-hour cut line.

**Exit gate:** one verified architecture decision, no unverified SDK calls, one written vertical-slice scenario.

### Phase 1 - Experience prototype (4-6 hours)

- [ ] Replace the dashboard-first landing with the zero-wallet rehearsal.
- [ ] Add Solo, Friend, and Benchmark mode cards; only Solo must be functional first.
- [ ] Add reason cards, confidence bands, and beginner risk language to the composer.
- [ ] Build a fixture-driven settled lesson card and Coach Inbox entry.
- [ ] Browser-test desktop and mobile before wiring persistence.

**Exit gate:** a judge can understand the new product and complete a fake end-to-end lesson without explanation.

### Phase 2 - Solo vertical slice (6-8 hours)

- [ ] Define the verified challenge/lesson record boundary using the selected persistence path.
- [ ] Save a reason commitment before the existing live trade flow.
- [ ] Attach the confirmed fill and transaction proof to the solo round.
- [ ] Implement deterministic lesson rules for direction, entry, and bounded risk.
- [ ] Display the result in Coach Inbox after a controlled worker check.

**Exit gate:** one real live trade becomes one persistent scheduled lesson after settlement.

### Phase 3 - Friend Reason Duel (6-8 hours)

- [ ] Create shareable challenge links keyed to one `marketId` and join cutoff.
- [ ] Support a second wallet commitment and confirmed trade proof.
- [ ] Reveal both reason cards after opponent commitment.
- [ ] Implement no-fill, timeout, market-closed, and void/no-contest states.
- [ ] Present winner and learning dimensions separately.

**Exit gate:** two wallets complete one real no-pot duel with independent DreamDEX positions.

### Phase 4 - Scheduled Coach worker (5-7 hours)

- [ ] Implement a read-only market-status worker using the verified bot-kit settlement pattern.
- [ ] Add retries, heartbeats, status logs, and idempotent result generation.
- [ ] Populate Coach Inbox without an open browser.
- [ ] Keep redemption user-signed in the browser.
- [ ] Document exactly which bot-kit patterns are reused and which SignalSprint components are custom.

**Exit gate:** closing both browsers does not prevent a settled duel result from appearing later.

### Phase 5 - Learning progression and return loop (4-6 hours)

- [ ] Add the three-lesson progression.
- [ ] Add `Use this lesson in the next window` without preselecting a direction.
- [ ] Add friend rematch.
- [ ] Add a deterministic benchmark opponent only if Solo and Friend are stable.
- [ ] Add a shareable proof card with privacy review.

**Exit gate:** a completed result creates one obvious, safe next action.

### Phase 6 - Prove and ship (6-8 hours)

- [ ] Run typecheck/build and all unit tests.
- [ ] Add tests for lesson rules, no-contest rules, idempotency, and lifecycle transitions.
- [ ] Browser-test rehearsal, solo, duel, inbox, settlement, redemption, errors, and mobile layouts.
- [ ] Save screenshots, console evidence, API responses, and transaction links.
- [ ] Deploy web app, service, and worker; verify the deployed flow rather than localhost only.
- [ ] Finish README, architecture diagram, 2-3 minute demo, feedback report, public repository, and submission.

**Exit gate:** every acceptance criterion is checked with pasted evidence.

### 24-hour cut line

[INFERRED] If time becomes constrained, ship Solo + one deterministic replay opponent + Scheduled Coach Inbox. Keep the friend-duel UI as an honest preview rather than faking cross-wallet persistence.

[INFERRED] Never cut real DreamDEX trade proof, settlement-triggered teaching, beginner rehearsal, or the deployed demo path; those are the product thesis.

## 13. Test matrix

### Unit tests

- Reason card validation and immutability.
- Entry-cost lesson thresholds.
- Direction result for UP, DOWN, void, and unresolved.
- Confidence history gate.
- No-fill and one-fill no-contest conversion.
- Duplicate worker delivery/idempotency.
- Next-market action never carries a prior side.

### Integration tests

- Persist commitment, attach confirmed trade, and read it from another session.
- Reject a trade proof with wrong wallet, market, side, failed receipt, or zero fill.
- Poll Trading -> Locked -> Resolved and produce one lesson.
- Poll Trading -> Locked -> Voided and produce no contest.
- Close browser before settlement and retrieve the generated inbox result later.

### Browser acceptance

- A visitor explains UP/DOWN after the rehearsal without wallet jargon.
- A connected user sees exact max loss before signing.
- A friend link opens the same market and visible cutoff.
- Technical proof is available but does not block the beginner flow.
- Mobile widths keep action, risk, and result content readable.
- Relevant console errors are zero on the deployed happy path.

## 14. Demo script

### 0:00-0:20 - Problem

[INFERRED] `Prediction markets let beginners click UP or DOWN, but they rarely explain what the trade taught them.`

### 0:20-0:45 - Zero-wallet lesson

[INFERRED] Complete the opening/closing rehearsal and reveal price-as-probability in plain language.

### 0:45-1:20 - Reason Duel

[INFERRED] Choose a live market, UP/DOWN, one reason, confidence, and bounded risk; create a friend challenge and show the real signed DreamDEX trade proof.

### 1:20-1:45 - Opponent commitment

[INFERRED] Join with the prepared second wallet or deterministic replay, lock the opposing reason, and reveal both calls.

### 1:45-2:20 - Scheduled lesson

[INFERRED] Jump to a prepared finalized round. Show that the worker detected settlement and produced `correct direction, expensive entry` or another deterministic lesson in Coach Inbox.

### 2:20-2:40 - Sponsor proof

[INFERRED] Open the Proof drawer: `marketId`, confirmed fills, lifecycle, outcome, transaction links, and user-signed redemption.

### 2:40-3:00 - Return loop

[INFERRED] Start a rematch in the next market and close with: `Every DreamDEX market becomes one lesson, one proof, and one reason to return.`

## 15. Rubric evidence

- [INFERRED] **Technical 25%:** live SDK trading, finite approvals, receipt/fill reconciliation, two-wallet records, read-only settlement worker, idempotent scheduled delivery, redemption.
- [INFERRED] **Innovation 20%:** reason commitment and settlement-triggered coaching transform a trade into a learning duel rather than adding another signal or dashboard.
- [INFERRED] **UX 20%:** zero-wallet rehearsal, plain-language risk, progressive proof disclosure, persistent inbox, and explicit no-contest states.
- [INFERRED] **Business/Ecosystem 20%:** beginners learn through real Event Contracts and return for the next short-duration market; no-custody design reduces onboarding risk.
- [INFERRED] **Presentation 15%:** the demo has a visible human consequence: two reasons go in, one chain-settled lesson comes out, plus verifiable sponsor evidence.

## 16. Risks and mitigations

| Risk | Status | Mitigation |
|---|---|---|
| Product still looks like a wrapper | [INFERRED] High | Lead with rehearsal, reason duel, scheduled result, and rematch; hide the old dashboard structure |
| Basic duel is generic | [VERIFIED] Prior art exists | Score reasons and entry quality; make settlement teach, not merely declare a winner |
| AI-oracle story is crowded | [VERIFIED] Current competitor exists | Use deterministic coaching; benchmark is read-only and secondary |
| Friend unavailable in demo | [INFERRED] Likely | Prepare second wallet and deterministic replay; Solo remains complete |
| Public chain reveals a hidden call | [VERIFIED] Inherent | Describe UI hiding honestly; do not claim cryptographic secrecy |
| Browser closes before settlement | [VERIFIED] SPA limitation | Persistent service + always-on worker + Coach Inbox |
| Worker and wallet race writes | [VERIFIED] Bot-kit warns about nonce races | Worker is read-only; user signs redemption in browser |
| Persistence integration consumes time | [ASSUMED] Unknown | Verify provider first; implement Solo vertical slice before Friend mode |
| Notification provider delays delivery | [ASSUMED] Unknown | In-app inbox is MVP; external messaging is stretch |
| Market/indexer lag creates false result | [VERIFIED] Documented risk | Chain-backed lifecycle status, retry, receipt checks, idempotency |
| Too many learning metrics confuse users | [INFERRED] Medium | Three concepts only; one next lesson per result |

## 17. Open decisions - do not guess

- [ASSUMED] `UNVERIFIED: persistence and deployment provider.` Options: verify an existing project solution; verify a minimal hosted database/service; or cut to deterministic replay if time is under 24 hours.
- [ASSUMED] `UNVERIFIED: exact current DreamBot Builder UI support for selecting ec-settlement and custom referee settings.` Verify in the live builder before describing it in the demo.
- [ASSUMED] `UNVERIFIED: external notification channel.` Options after MVP: browser push, email, Telegram, or Discord; each requires separate provider/API verification and user approval before adding a dependency or secret.
- [ASSUMED] `UNVERIFIED: underlying reference-price source and reason thresholds.` Reuse only data already exposed by verified SDK/source paths or verify a new source before coding.
- [ASSUMED] `UNVERIFIED: remaining builder hours.` The user must choose the 24-hour cut line if available time cannot support the full friend-duel service.

## 18. Immediate next three steps

1. [INFERRED] Verify the persistence/deployment path and record exact package/API versions before writing integration code.
2. [INFERRED] Build Phase 1 as a fixture-driven vertical experience: rehearsal -> reason commitment -> settled lesson -> inbox.
3. [INFERRED] Connect that experience to one existing real trade and one scheduled settlement result before adding the second wallet.

## 19. Sources checked

- [VERIFIED] Local installed package: `node_modules/@somnia-chain/markets-sdk/package.json` (`0.28.1`).
- [VERIFIED] Official Event Contract docs: <https://app.dreamdex.io/docs/developers/event-contracts>
- [VERIFIED] Official Event Contract recipes: <https://app.dreamdex.io/docs/developers/event-contracts/recipes>
- [VERIFIED] Official Event Contract market structure: <https://app.dreamdex.io/docs/developers/event-contracts/market-structure>
- [VERIFIED] Official Bot Kit repository: <https://github.com/somnia-chain/dreamdex-bot-kit>
- [VERIFIED] Official Bot Builder: <https://app.dreamdex.io/dreambot-builder>
- [VERIFIED] Prior-winner research supplied by the user: `/home/himanshu/Downloads/Event Contracts Hackathon_ What Made the Previous Winners Stand Out.md`.
- [VERIFIED] Current competitor reference: <https://github.com/binasalama12/predictrader-ai>
