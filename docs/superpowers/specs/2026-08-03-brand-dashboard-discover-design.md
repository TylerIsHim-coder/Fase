# Brand Dashboard + Discover

## Goal

Give brands a Trybe-like **Dashboard** home and a **Discover** tab to invite creators from the roster, using the same colors, card styles, and floating nav as the new influencer home — not the purple web Brand Portal theme.

## Decisions (approved)

- **IA:** Replace Campaigns tab with Dashboard; add Discover; keep Pitches + Analytics; Profile via avatar (no Profile tab).
- **Dashboard v1:** Welcome + status + hero pulse + getting-started + summary cards (not a campaigns dump).
- **Invite:** Same as today’s Book flow; CTA labeled **Invite** (pick campaign → booking request).
- **Approach:** Restyle + restructure in place; reuse booking/roster; no new backend for v1.

## Navigation

| Slot | Tab |
|------|-----|
| 1 | Dashboard (home) |
| 2 | Discover |
| center | `+` create campaign |
| 3 | Pitches |
| 4 | Analytics |

- Avatar on Dashboard → Profile screen (existing profile route, reachable without a tab chip).
- Profile may remain a hidden `Tabs.Screen` for routing, but must not appear as a tab chip.
- Tab bar: `FaseTabBar` `variant="trybe"` (same frost/navy as influencer).

## Dashboard

**Shell:** `HomeAmbientBackground`, welcome eyebrow + brand name, avatar.

**Status pill:** “X pitches need review” or “You’re all caught up” from real pitch counts.

**Hero card (gradient wash like influencer earnings):** Brand pulse — active campaigns, open pitches, followers. Taps route to Analytics / Pitches as relevant.

**Getting started (0/4 checklist):**

1. Complete brand profile (photo/name)
2. Create your first campaign
3. Add shop/website on a campaign (product brands)
4. Invite a creator → Discover

**Action cards (2-up):**

- Pitches waiting → Pitches
- Your campaigns → secondary campaigns screen

**Secondary cards (2-up):**

- Creator spend (30d) — real payouts or empty + CTA to Discover
- Top creators — from completed deals or empty + CTA to create campaign

No fake brand-health score in v1.

## Campaigns secondary screen

- Route e.g. `/(developer)/campaigns` from Dashboard “Your campaigns”
- Host today’s campaign grid, contests, long-press menu, upload/tutorial hooks
- Create via center `+` and checklist / empty CTAs (`NewCampaignModal`)
- Drop TikTok-style profile header from old home; profile only via avatar → Profile

## Discover

- Ambient wash + soft cards
- Search + light filters (existing tier/price/niche where already present)
- Creator cards: name, niche, followers, rate; **Invite** CTA; level lock unchanged
- Invite → existing `BookingSheet` → pick campaign → booking request (Pitches/deals unchanged)
- Card tap → existing creator profile / reel view if present
- Roster v1: current browse roster (`mockCreators` / existing browse data)

No invite credits, GMV columns, or Meta connect in v1.

## Visual system

- Reuse influencer home tokens: ambient wash, soft white cards, gradient hero, Trybe tab bar
- Faze influencer palette — not Trybe web purple
- Soft borders / light elevation; avoid dense admin chrome

## Out of scope (v1)

- Brand health score, Meta connect, invite credits, GMV metrics
- Live Firestore influencer directory
- Soft invite without a campaign
- Web sidebar / Brand Portal layout

## Success criteria

- Brand opens app → Dashboard that visually matches influencer home language
- Can open campaigns list, create via `+`, review pitches, see analytics
- Can Discover → Invite → booking request without a new invite product
- Profile reachable from avatar; tab bar not overcrowded
