# Event Contracts Hackathon Findings

## Event
- [VERIFIED] Somnia x DreamDEX Event Contracts Hackathon.
- [VERIFIED] Public listing says online event, prize pool is $5,000 USDso, and submissions run from Aug 25, 2026 to Sep 8, 2026. Source: Eventbrite listing for the event.

## What the docs say
- [VERIFIED] DreamDEX Event Contracts are simple Up/Down markets on BTC and ETH with 15-minute and 1-hour windows, zero fees, capped risk, and on-chain settlement in USDso.
- [VERIFIED] The market lifecycle is listed as Listed -> Trading -> Locked -> Resolved or Voided.
- [VERIFIED] Developers should key state by `marketId`, not pool address, because pools are recycled across windows.
- [VERIFIED] The indexer can lag, so writes should be gated on the on-chain market status before every trade.

## Judging signal
- [ASSUMED] The indexed event summary shows judging weights of Innovation 20%, Technical 25%, UX 20%, Business 20%, and Presentation 15%.
- [VERIFIED] The event brief invites consumer trading apps, AI-powered trading agents, analytics tools, social prediction products, and entirely new experiences.

## Prior-art pattern
- [VERIFIED] Previous standout Somnia projects won by making the sponsor primitive essential to the product, not decorative.
- [VERIFIED] Strong submissions had a clear human outcome, a closed action-to-settlement loop, and concrete proof that the system really worked.
- [VERIFIED] Generic trading dashboards, passive analytics pages, and “just another bot” patterns are crowded and weaker.

## Recommended direction
- [INFERRED] Best fit: a decision-to-consequence product, not a generic prediction dashboard.
- [INFERRED] Strongest concept: an Event Contract copilot or trading room that explains a real market, lets the user act, and then shows settlement or a visible consequence.
- [INFERRED] The winning demo should show: market discovery -> user decision -> trade -> expiry/settlement -> proof of outcome.

## Practical constraints
- [VERIFIED] Submission needs a working testnet prototype, public repo, and 2 to 3 minute demo video.
- [VERIFIED] The docs surface DreamDEX Event Contracts through `@somnia-chain/markets-sdk`.
- [VERIFIED] Raw reads/writes should respect venue-specific tick and lot grids.

## Bottom line
- [INFERRED] Build something that makes a judge say: “I know who this helps, I can see why Event Contracts are required, and I can watch the payoff happen.”

## Sources
- Event brief: https://dorahacks.io/hackathon/event-contracts/detail
- Public listing: https://www.eventbrite.com/e/event-contracts-hackathon-tickets-1998344868295
- DreamDEX Event Contracts docs: https://app.dreamdex.io/docs/trading/event-contracts
- Market structure docs: https://app.dreamdex.io/docs/developers/event-contracts/market-structure
- Gotchas docs: https://app.dreamdex.io/docs/developers/event-contracts/gotchas
- Prior-art research note: attached markdown file in Downloads, dated 26 August 2026
