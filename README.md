# Exhibit

A workbench for chargeback analysts. You give it a case (reason code, transaction data, issuer narrative and the merchant's evidence files) and it gives back a representment workup: what the issuer is alleging, whether each piece of compelling evidence is there, a draft rationale, and a recommended action. Every finding points at the exact passage in the merchant's documents, highlighted in place, so the analyst can check it in seconds instead of opening four PDFs.

There's a step-by-step tour with screenshots in [WALKTHROUGH.md](WALKTHROUGH.md).

**Live demo:** https://exhibit-disputes.fly.dev. You can browse the 10 cases and also upload a new one to see a live analysis.

## Running it

The 10 provided cases come with their analysis already generated (in `seed/`), so you can browse everything without an API key. You only need a key to analyse new cases or re-analyse a case after adding evidence.

**With Docker** (easiest):

```bash
git clone https://github.com/yuktae/CaseStudy_Checkout_Yukta.git
cd CaseStudy_Checkout_Yukta
cp .env.example .env
docker compose up --build
```

Then open http://localhost:8080. Add your `ANTHROPIC_API_KEY` to `.env` first if you want to run new analyses. The first build takes a few minutes because of the OCR runtime.

**Without Docker** (Python 3.12, Node 20+):

```bash
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000
```

and in another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Then open http://localhost:5173. On Windows use `.venv\Scripts\` instead of `.venv/bin/`.

**Command line:**

```bash
cd backend
../.venv/bin/python -m app.cli run --all   # analyse every case and refresh seed/
../.venv/bin/python -m app.cli eval        # compare the recommendations with eval/expected.json
../.venv/bin/python -m pytest tests -q     # tests, no API key needed
```

To use a different dataset, replace `data/` (same `cases.json` + `documents/` layout), delete `storage/` and run `app.cli run --all`. Nothing in the code is specific to these 10 cases.

## How it works

Each case goes through the same steps:

1. **Intake.** The case is validated against the `cases.json` schema and the files are stored.
2. **Reading the documents.** For PDFs I use PyMuPDF, which gives the text and the position of every word on the page. Images (and scanned pages) are read by Claude's vision model, and RapidOCR finds where each line of text sits so it can be highlighted.
3. **Rule checks, in code.** `reason_codes.md` is turned into `rules.yaml`: each code's requirements and whether all of them are needed, any two, or any one. Some codes (Visa 10.5, Mastercard 4870) are auto-accept. This step also builds the transaction signals (AVS, CVV, 3DS, address, device) and finds linked cases that share a device, IP or postcode.
4. **Assessment, by the LLM.** One Claude call per case, with structured JSON output. For each requirement it returns a verdict, a short finding, verbatim quotes with the page they came from, the gap and whether it's fixable. It also says which documents are irrelevant, flags conflicts, and drafts the rationale, justification and merchant requests.
5. **Checking the quotes.** Every quote is searched for in the extracted text (exact first, then fuzzy, tolerant of line breaks and OCR spacing) and turned into highlight boxes. If the model cites the wrong page, the quote is found on the right one. If it can't be found at all, it's marked unverified, doesn't count as evidence, and lowers the verdict it was supporting.
6. **The decision, in code.** The recommended action comes from the verified verdicts and the rule logic, not from the model. Delivery dates are checked against the chargeback date in code too. If the model's own recommendation disagrees with the rules, the case is flagged "Needs judgement" and both views are shown. Confidence comes with the reasons that lowered it.

The split is deliberate: anything that has to be exact (rules, dates, counting, checking quotes) is plain code, and the model does the reading and the writing.

The default model is `claude-opus-5` (change it with `MODEL` in `.env`). A case takes about 40 seconds.

### Why this approach to documents

The brief asks how to handle PDFs and images. Each option on its own has a catch:

- Text extraction alone is fast and exact, but it can't see screenshots. In case 0002 the only proof of delivery is a PNG.
- Tesseract OCR would need a system install, which works against "runnable in 10 minutes", and it reads characters without understanding them ("front view only", "left in safe place").
- A vision model understands images well but can't tell you where on the page a line is, and I needed that for highlighting.

So it's a mix. PyMuPDF for PDF text and positions, Claude vision to read images, and RapidOCR (a pip install, no system dependencies) to locate lines in images. Images embedded inside PDFs get OCR'd and mapped back onto the page. In the UI, each quote shows where it came from: verified in the document, read from an image, taken from the vision model's description, or not found.

### Surfacing uncertainty

The brief says this matters more than getting every call right, so the tool is explicit about what it isn't sure of:

- unverified quotes are struck through and don't count;
- "Needs judgement" when the rules and the model disagree, and the draft rationale says if it argues for the other action;
- confidence is shown with its reasons, for example "key evidence read from an image";
- alerts for things that are easy to miss: evidence on page 8 of 10, a rule that forces the outcome, a missing file, linked cases;
- "not relevant" is kept separate from "missing", so a merchant's own fraud score shows up as uploaded but irrelevant, with the reason.

## The analyst side

I designed the screens around cognitive load. The scheme rules are complicated and there's no point hiding that. What can go is the effort the current process adds on top: looking the rules up again, hunting through PDFs, writing everything from scratch, and flicking between windows to connect a requirement with its evidence.

**Dashboard.** A "New case" area at the top (drop files or a case JSON, or open the form), and the case list underneath. The list has status tabs (To review, In review, Awaiting merchant, Completed), search, filters (scheme, category, recommendation, confidence, flags) and a sort that defaults to easiest first, so the clean cases can be cleared quickly. Filters are kept in the URL, so going back from a case restores the view. New analyses show their progress in a small panel in the bottom right.

**Case page.** The workup is on the left, in the order the brief lists it: reason code summary, evidence assessment (one card per requirement), rationale, recommended action, and the merchant requests when more evidence is needed. The documents are on the right. Clicking a quote opens the right document, scrolls to the page and pulses the highlight. Hovering a requirement lights up its highlights, and clicking a highlight takes you back to the requirement. `[` and `]` step through the evidence.

**What the analyst can change.** Any verdict (with a note), whether a document counts as evidence, the recommended action (a reason is required), the justification, the rationale and the merchant requests. The AI's version is kept next to the analyst's. Save keeps the review. Complete shows a summary of what's being filed, sets the status and moves on to the next open case. Adding evidence brings up a "Re-analyse case" button; the new analysis becomes a new version, changed verdicts are tagged "Updated", and edited text is kept with a note if the AI now suggests something different.

## Results on the provided cases

Before building the tool, I wrote down the expected action for each case from a read-through against the rules (`eval/expected.json`). The tool agrees on all 10, and all 49 quotes it cited were found in the documents.

| Case | Code | Recommendation | Confidence | Notes |
|---|---|---|---|---|
| 0001 | Visa 13.1 | Represent | High | Signed delivery to the matching address; linked to 0005 and 0010 (same device and IP) |
| 0002 | Visa 13.1 | Request more evidence | Low | Delivered to an address the cardholder disputes; the proof is a screenshot |
| 0003 | MC 4837 | Represent | High | AVS + CVV match and 3DS, which is two of the four |
| 0004 | MC 4837 | Accept liability | Medium | The only document is the merchant's own risk score, marked not relevant |
| 0005 | Visa 12.6.1 | Represent | High | Two separate orders; the BST/UTC timestamp difference is noted |
| 0006 | Visa 13.3 | Request more evidence | Low | A front-view photo can't show a wobbling frame; nothing shows what happened to the refund request |
| 0007 | MC 4855 | Represent | High | The proof is on page 8 of 10, matched on the transaction reference rather than the look-alike rows |
| 0008 | Visa 13.2 | Request more evidence | Medium | Only generic terms; a policy isn't proof a notice was sent |
| 0009 | MC 4859 | Represent | High | Booking, consent, no-show log and fee all check out; the charge date is flagged |
| 0010 | Visa 10.5 | Accept liability | Low, needs judgement | The model argued for representing because the evidence looks strong; the auto-accept rule held |

A few honest caveats. After the first full run I adjusted the prompt once, to stick to the simplified rule wording, keep flags for things that matter, and always produce merchant requests when asking for evidence. With only 10 cases there's no held-out set, so treat the 10/10 as a sanity check rather than a benchmark. Between runs, the variation showed up in the flags rather than the actions: case 0010 went from agreement to "Needs judgement" with the same final outcome.

## Project layout

```
backend/app/
  main.py         API, and serves the built frontend
  pipeline.py     runs the steps, background jobs, seeding
  documents.py    PDF text and positions, OCR, image pages
  vision.py       Claude vision call
  assess.py       Claude assessment call (prompt and output schema)
  locate.py       finds each quote and builds the highlight boxes
  decide.py       rule logic, date checks, confidence, alerts
  rules.py/.yaml  scheme rules, transaction signals, linked cases
  llm.py          Anthropic client (structured output, fallback, errors)
  cli.py          run and eval commands
backend/tests/    pipeline tests with the LLM calls stubbed out
frontend/src/     React + TypeScript (Vite, Tailwind, Framer Motion, react-pdf)
data/             the challenge dataset
seed/workups/     pre-generated analyses for the demo
eval/             expected actions used by the eval command
```

## Configuration

Set in `.env` (see `.env.example`):

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | Needed for new analyses and re-analysis |
| `MODEL` | `claude-opus-5` | Model used for both calls |
| `ASSESS_EFFORT`, `VISION_EFFORT` | `high`, `medium` | Reasoning effort per call |
| `DEMO_ACCESS_CODE` | empty | If set, uploads and re-analysis ask for this code (useful on a public URL) |
| `SEED_ON_START` | `true` | Load `data/` and `seed/` on first start |
| `MAX_FILES`, `MAX_FILE_MB` | `4`, `20` | Upload limits |

## Deploying

There's a `fly.toml` for fly.io. With the fly CLI logged in:

```bash
fly apps create exhibit-disputes
fly volumes create exhibit_data --region lhr --size 1
fly secrets set ANTHROPIC_API_KEY=... DEMO_ACCESS_CODE=...
fly deploy
```

Browsing is open; uploading and re-analysing ask for the access code so a public link can't run up API costs.

## Limitations and what I'd do next

- The rules are the simplified ones from the exercise, with no time limits, thresholds or exclusions.
- Confidence is a simple, transparent heuristic, not a calibrated probability. Since overrides are stored next to the AI's original answers, the obvious next step is to measure where analysts disagree, by reason code, and tune from that.
- One assessment call per case is fine at this size (the 10-page manifest is about 6,000 characters). Much bigger evidence packs would need a retrieval step first.
- Image highlights depend on OCR finding the line. When it can't, the whole image is outlined and marked as approximate.
- SQLite on one volume is fine for a demo. A production version would need Postgres, object storage, authentication and per-analyst audit trails.
- Not built yet: a "regenerate rationale" button, and an insights page (override rate by reason code, time per case).
