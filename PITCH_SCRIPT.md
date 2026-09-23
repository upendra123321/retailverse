# RetailVerse — 5-Minute Pitch Script

**Target length:** ~4:40–4:55 spoken at a natural pace (≈145–150 wpm, ~700 words).
Slide numbers below match `RetailVerse_PopulationScaleShopperValidation_Pitch.pptx`
(20 slides). This script deliberately touches every required pitch-video
content point in order: **team intro → problem → solution → tech E2E →
key features/innovation → impact/feasibility → call to action.**
Bracketed notes are delivery cues, not to be read aloud.

> For a longer, hands-on live walkthrough instead of this recorded pitch —
> especially one that proves the AI/LLM guardrails, security, and panel
> privacy controls live with real commands — see
> **[DEMO_SCRIPT.md](DEMO_SCRIPT.md)**.

---

### [Slide 1 — Title] 0:00–0:15
Quick question. Before an airline lets a pilot fly *your* plane, do they hand them the keys on day one? No — they put them in a flight simulator first, until it matches a real cockpit closely enough that everyone trusts it. That's the bet we made this weekend, except the pilots are shoppers and the cockpit is a grocery aisle. We built **RetailVerse**.

### [Slide 2 — Team Introduction] 0:15–0:30
*[Replace with your real names/roles before recording]* I'm [Name], [role]. With me: [Name] on [role], [Name] on [role], and [Name] on [role]. Four of us, one weekend, one working end-to-end system.

### [Slide 3 — The Problem] 0:30–1:00
Here's the problem retail brands actually have. Want to know if moving the cereal to eye-level sells more boxes, or if a parking-lot billboard even gets noticed? Today that means renting a store, recruiting panelists, strapping on eye-tracking headsets, and waiting weeks — for maybe thirty people. By the time the study comes back, the shelf's already been rearranged three times.

### [Slide 4 — Our Solution] 1:00–1:20
So: what if the simulator came first? One browser-based 3D convenience store. Real humans shop in it with just a webcam and a keyboard. AI shopper personas shop in that *exact same* store on their own. Same shelves, same billboards, same metrics logged for both — and validated against each other, every time.

### [Slides 5–6 — Real shoppers + AI personas] 1:20–1:55
Your webcam becomes the eye-tracker — 30-second calibration, then WASD through the aisles. Every glance, every pause, every item dropped in the basket gets logged. For the AI side, we didn't ask a chatbot to "pretend to be a shopper" — that's a coin flip you can't audit. Every persona is a rulebook instead: how directly they walk, how patient, how price-sensitive. Deterministic and replayable.

### [Slide 7 — Agentic Quality] 1:55–2:20
And this is a real agentic pipeline, not a chat window with extra steps: goal decomposition builds each persona's shopping list into an ordered target queue; a vision LLM and a judge LLM are two distinct, purpose-built tool calls with typed parameters; the same logic orchestrates a whole population at once; and every run ends in a measured, logged outcome — a number in the database, not just a plausible-sounding transcript.

### [Slide 8–9 — Population scale + A/B testing] 2:20–2:50
Because it's rules, not roleplay, it's fast — headless, no browser, no GPU. A hundred full shopper journeys in about two seconds — a real panel size, on demand, for free. Point that at a real question: busy aisle or quiet one for the banner? Does the parking-lot billboard even get noticed before someone walks in? One toggle flips both placements, indoors and out, and we track attention on each.

### [Slide 10–11 — Validation & Business Value] 2:50–3:15
We correlate AI results against real sessions — similarity scores, a heatmap comparing real and AI attention on the same floor plan. That's our actual measurable success indicator, not a nice-to-have chart. The target user: any retail or CPG insights team deciding shelf and ad spend before committing budget — and the path beyond this prototype is the same pipeline, scaled to a retailer's full store estate.

### [Slides 12–15 — Tech, security & evidence] 3:15–3:50
Under the hood: React and Three.js, FastAPI and SQLite, one Docker image, one HTTPS origin, because webcams need that. The LLM is optional seasoning for narration only. And because "trust us" isn't evidence: every request is size- and shape-checked before we touch it, every LLM-backed endpoint is rate-limited, every consequential action is audit-logged, user text is screened for prompt injection, and locked-down security headers block clickjacking and stray camera access — backed by 61 automated tests, passing in under two seconds, that you can run yourself.

### [Slide 16 — Challenges] 3:50–4:00
We hit real potholes — a cross-platform install bug, an LLM call that once hung the UI — and every one got a real fix, not a band-aid.

### [Slide 18–19 — Impact & Next Steps] 3:55–4:20
What used to take weeks and a five-figure budget now takes minutes, in a browser tab, validated instead of assumed. We're upfront about what's not done — no user accounts yet, a simple pricing model — and just as clear on what's next: real accounts, richer surveys, and eventually this engine driving an AR headset instead of a browser tab, the long game this challenge asked for.

### [Slide 20 — Close] 4:35–4:50
Pilots don't fly blind. Retailers shouldn't guess blind either. We built the simulator — real shoppers, AI shoppers, one validated truth. Try it yourself at the link on screen — thank you.

---

## Delivery tips
- **Bookends:** the flight-simulator line at the start and "one validated truth" at the end — say these slower, let them land.
- **Before recording:** fill in real names/roles on Slide 2, and swap the GitHub link on Slide 20 if it's changed.
- **If running long:** cut the Challenges beat (Slide 16) — easiest 15 seconds to lose.
- **If running short:** expand Slide 10 with a live number from your own dashboard run (actual cosine similarity score, or "100 shoppers in 2 seconds" if it's on screen).
- **Live demo fallback:** the screenshots baked into slides 5, 8–10, and 17 are real captures from an actual run — you can present entirely from the deck with zero risk if the live demo or webcam fails.
- **Recording:** use Microsoft Teams with the official Hackfest background image (swap in once you have the actual file — see the note in this repo's chat history about the template/background links).
