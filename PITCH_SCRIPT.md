# RetailVerse — 5-Minute Pitch Script

**Target length:** ~4:30–4:50 spoken at a natural pace (≈140–150 wpm, ~680 words).
Slide numbers below match `RetailVerse_Pitch_Deck.pptx`. Bracketed notes are delivery cues, not to be read aloud.

---

### [Slide 1 — Title] 0:00–0:20
Quick question. Before an airline lets a pilot fly *your* plane, do they hand them the keys on day one?

No. They put them in a flight simulator first — hundreds of hours, every weather condition, every emergency — until the simulator's readings match a real cockpit closely enough that everyone trusts it.

That's exactly the bet we made this weekend. Except instead of pilots, it's shoppers. And instead of a cockpit, it's a grocery aisle.

We built **RetailVerse**.

### [Slide 2 — The Problem] 0:20–0:55
Here's the problem retail brands actually have. Want to know if moving the cereal to eye-level sells more boxes? Want to know if a billboard by the parking lot even gets noticed? Today, that means renting a store, recruiting real panelists, strapping eye-tracking headsets on them, and waiting *weeks* for a report — for maybe thirty people.

By the time the study comes back, the shelf's already been rearranged three times. It's like designing a car and only being allowed to crash-test it *after* it's already on the road.

### [Slide 3 — Our Solution] 0:55–1:25
So we asked: what if the flight simulator came first?

We built one browser-based 3D convenience store. Real humans shop in it using nothing but their webcam and a keyboard. And AI shopper personas — with their own personalities, patience, and price sensitivity — shop in that *exact same* store, on their own.

Same building. Same shelves. Same billboards outside. Same metrics logged for both. That last part is the whole trick: we don't just *simulate* shoppers, we **validate** the simulation against real ones, every single time.

### [Slide 4–5 — Real + AI shoppers] 1:25–2:00
Your webcam becomes the eye-tracker — a 30-second calibration, then WASD to walk the aisles. Every glance, every pause, every item dropped in the basket gets logged.

For the AI side, we didn't ask a chatbot to "pretend to be a shopper" — that's a coin flip you can't audit. Every persona is a rulebook instead: how directly they walk, how patient they are, how price-sensitive. Deterministic and replayable — a stunt double who's rehearsed the choreography, not an improv actor guessing.

### [Slide 6 — Population Scale] 2:00–2:25
Because it's rules, not roleplay, it's fast — headless, no browser, no GPU. A hundred full shopper journeys, purchases and all, in about two seconds. That's the "population" in population-scale: a real panel size, on demand, for free.

### [Slide 7 — A/B Testing] 2:25–2:50
Point that at a real question: does the banner work better on the busy aisle or the quiet one? And since the challenge asked us to look *outside* the store — does the parking-lot billboard even get noticed before someone walks in? One toggle flips both placements, and we track attention on each.

### [Slide 8–9 — Validation & Architecture] 2:50–3:35
Here's the trust part: we don't just report AI numbers and hope you believe us. We correlate them against real sessions — similarity scores, a heatmap showing real attention next to AI attention on the same floor plan. If the simulator drifts from reality, you'll see it.

Under the hood it's deliberately boring where it counts: React and Three.js for the store, FastAPI and SQLite underneath, one Docker image, one HTTPS origin, because webcams need that. An LLM is optional seasoning for narration — it never touches navigation or the numbers, and everything keeps working without it.

### [Slide 11 — Challenges] 3:35–3:50
We hit real potholes — a cross-platform install bug, a React dev-mode bug duplicating sessions, an LLM call that once hung the UI. Every one got a real fix, because a simulator you can't trust is worse than none.

### [Slide 13–14 — Impact & Future] 3:50–4:15
So: what used to take weeks and a five-figure budget now takes minutes, in a browser tab, validated instead of assumed. And it's just the runway — natural-language personas, richer surveys, and eventually this same engine driving an AR headset instead of a browser tab, which was the long game this challenge asked for.

### [Slide 15 — Close] 4:15–4:30
Pilots don't fly blind. Retailers shouldn't guess blind either. We built the simulator — real shoppers, AI shoppers, one validated truth.

Thank you — happy to take it for a spin.

---

## Delivery tips
- **Pace:** the flight-simulator line at the start and the "one validated truth" line at the end are your bookends — say them slower and let them land.
- **If you're running long:** cut the Slide 11 (Challenges) beat entirely — judges rarely dock points for skipping it, and it's the easiest 20 seconds to lose.
- **If you're running short:** expand Slide 8 (validation) with a concrete number from your own live dashboard run (e.g., the actual similarity score or "100 shoppers in 2 seconds" if it's on screen).
- **Live demo fallback:** if the projector/webcam fails, the screenshots baked into slides 4–8 and 12 are real captures from an actual run — you can present entirely from the deck with zero risk.
