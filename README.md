# Exhibit

A workbench for chargeback analysts. Give it a case (reason code, transaction data, issuer narrative and the merchant's evidence files) and it returns an analyst-ready representment workup: what the issuer is alleging, whether each compelling-evidence requirement is met, a draft rationale and a recommended action. Every finding points at the exact line in the merchant's documents, highlighted in place, so the analyst can check it in seconds instead of opening four PDFs.

**Live demo: https://exhibit-disputes.fly.dev**. Browse the 10 provided cases, or upload a new one to watch a live analysis.
**Walkthrough with screenshots:** [WALKTHROUGH.md](WALKTHROUGH.md)

![How a case is processed](docs/workflow.png)

## Run it (under 10 minutes)

The 10 provided cases ship with their analysis already generated (`seed/`), so everything can be browsed without an API key. A key is only needed to analyse new cases or re-analyse after adding evidence.

**With Docker**

```bash
git clone https://github.com/yuktae/CaseStudy_Checkout_Yukta.git
cd CaseStudy_Checkout_Yukta
cp .env.example .env          # add ANTHROPIC_API_KEY to run new analyses
docker compose up --build
```

Open http://localhost:8080. The first build takes a few minutes because of the OCR runtime.

**Without Docker** (Python 3.12, Node 20+)

```bash
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000
# in a second terminal
cd frontend && npm ci && npm run dev
```

Open http://localhost:5173. On Windows use `.venv\Scripts\` instead of `.venv/bin/`.

**From the command line**

```bash
cd backend
../.venv/bin/python -m app.cli run --all   # analyse every case and refresh seed/
../.venv/bin/python -m app.cli eval        # compare with the expected actions in eval/expected.json
../.venv/bin/python -m pytest tests -q     # tests, no API key needed
```

## How a case flows through the code

The split is deliberate: the LLM does the reading and the writing, and plain code does everything that has to be exact (rules, dates, counting, checking quotes, the final decision). The backend lives in `backend/app/`.

1. **Intake** (`main.py`, `pipeline.py`). The case is validated against the `cases.json` schema, the files are stored and a background job starts. Its progress shows in a small panel in the UI.
2. **Reading the documents** (`documents.py`, `vision.py`). PDFs go through PyMuPDF, which gives the text and the position of every word. Images are read by a vision model, and RapidOCR finds where each line sits so it can be highlighted.
3. **Rules and checks** (`rules.yaml`, `rules.py`). `reason_codes.md` is encoded as data: each code's requirements and whether it needs all of them, any two, any one, or can't be represented at all (Visa 10.5, Mastercard 4870). This step also builds the AVS, CVV, 3DS and address checks, and finds linked cases that share a device, IP or postcode.
4. **Assessment** (`assess.py`). One structured LLM call per case. For each requirement it returns a verdict, a finding, verbatim quotes with their page, the gap and whether the merchant could fix it. It also marks irrelevant documents, flags conflicts, and drafts the rationale, justification and merchant requests.
5. **Checking every quote** (`locate.py`). Each quote is searched for in the extracted text (exact first, then fuzzy) and turned into highlight boxes. A quote on the wrong page is moved to the right one. A quote that can't be found doesn't count as evidence and lowers the verdict it supported.
6. **The decision** (`decide.py`). The recommended action comes from the verified verdicts and the rule logic, not from the model. Delivery dates are checked against the chargeback date. If the model's own recommendation disagrees, the case is flagged "Needs judgement". Confidence always comes with the reasons that lowered it.

The frontend (`frontend/src`, React + TypeScript) has two pages: the dashboard (`pages/dashboard`) and the case analysis (`pages/analysis`).

## What the analyst sees

![Dashboard](docs/screenshots/01-dashboard.png)

**Dashboard.** The case queue, sorted easiest first so clean cases can be cleared quickly. Each card answers the triage questions: who, how much, which rule, what the tool recommends, how sure it is, and whether something needs a look. Tabs follow the case lifecycle, and filters and search are kept in the URL.

![Case analysis](docs/screenshots/11-case-analysis.png)

**Case analysis.** The verdict and the transaction checks sit at the top. Anything easy to miss (a conflict, a rule that forces the outcome, evidence on page 8 of 10) shows as a heads-up chip. The workup follows the brief's order: reason code summary with a "to defend" checklist, evidence assessment, rationale, recommended action and merchant requests. The documents are on the right, and clicking a quote jumps to the highlighted line.

**What the analyst can override:** any verdict (with a note), whether a document counts as evidence, the recommended action (a reason is required), the justification, the rationale and the merchant requests. The AI's version is kept next to the analyst's. "Add evidence" uploads more files and re-analyses the case as a new version.

## Reading the documents: the tradeoff

- Text extraction alone is fast and exact, but it can't see images. In case 0002 the only proof of delivery is a screenshot.
- Tesseract OCR needs a system install, which works against "runnable in 10 minutes", and it reads characters without understanding them ("front view only", "left in safe place").
- A vision model understands images well but can't say where on the page a line is, which highlighting needs.

So it's a mix: PyMuPDF for PDF text and positions, a vision model to read images, and RapidOCR (a pip install, no system dependencies) to locate their lines. Each quote in the UI shows where it came from: verified in the document, read from an image, or not found.

## Surfacing uncertainty

- Quotes that can't be found in the documents are struck through and don't count.
- "Needs judgement" appears when the rule check and the model disagree, and the rationale is labelled if it argues for the other action.
- Confidence is shown with its reasons, for example "key evidence read from an image".
- "Not relevant" is kept separate from "missing", so a merchant's own fraud score shows as uploaded but irrelevant, with the reason.
- Heads-up chips cover what's easy to miss: conflicts, deep pages, rules that decide the outcome, linked cases.
- Every partial or missing requirement says what's still needed and whether the merchant could fix it.

**How confidence is calculated** (`decide.py`, `score_confidence`). Confidence is about the recommended action. It starts at High and each failed check lowers it one level (none failed: High, one: Medium, two or more: Low):

1. Key evidence comes from document text, not only from an image.
2. Every quoted passage was found in the documents.
3. No conflict in the evidence. A conflict doesn't count when accepting, because a merchant claim that the data contradicts can only support accepting.
4. The rule check and the AI recommendation agree.
5. When accepting a case that could be represented, no requirement is partly met (otherwise it may be closer than it looks).

Data inconsistencies, such as a time-zone difference, are shown as notes but don't change the level. The case page lists every check with a tick or a cross.

## Results on the 10 cases

Before building the tool I wrote down the expected action for each case (`eval/expected.json`). The tool agrees on all 10, and all 51 quotes it cited were found in the documents.

| Case | Code | Dataset hint | Recommendation | Confidence | What the analyst sees |
|---|---|---|---|---|---|
| 0001 | Visa 13.1 | Straightforward | Represent | High | Signed delivery to the matching address |
| 0002 | Visa 13.1 | Check the addresses | Request more evidence | Low | Delivered to an address the cardholder disputes; postcodes differ, AVS failed; the proof is a screenshot |
| 0003 | MC 4837 | How many are needed? | Represent | High | Any two are needed: AVS + CVV match and 3DS |
| 0004 | MC 4837 | Evidence sounds confident | Accept liability | High | The merchant's risk score is marked not relevant; its "legitimate" conclusion is flagged against failed AVS, CVV and no 3DS |
| 0005 | Visa 12.6.1 | Two charges, same day | Represent | High | Two separate orders |
| 0006 | Visa 13.3 | What can the photo tell you? | Request more evidence | Low | A front-view photo can't show a wobbling frame; nothing shows the refund request was answered |
| 0007 | MC 4855 | Evidence is in there somewhere | Represent | High | The proof is one line on page 8 of 10, matched on the transaction reference |
| 0008 | Visa 13.2 | Policy vs proof | Request more evidence | Medium | Only generic terms; a policy isn't proof a notice was sent |
| 0009 | MC 4859 | Read the policy and the log together | Represent | Medium | All four met, but the booking says the rate was charged at booking while this charge is dated the stay day: confirm there's no double charge |
| 0010 | Visa 10.5 | Read the rules carefully | Accept liability | High | 10.5 can only be fought by proving miscoding; the genuine-looking evidence doesn't count |

With only 10 cases there's no held-out set, so treat 10/10 as a sanity check rather than a benchmark. Between runs the variation shows up in flags and confidence, not in the actions. On one earlier run the model argued to represent 0010; the rule in code held the outcome and flagged the case "Needs judgement", which is what that safety net is for.

## Configuration

Set in `.env` (see `.env.example`):

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Needed for new analyses and re-analysis |
| `MODEL`, `ASSESS_EFFORT`, `VISION_EFFORT` | Model and reasoning effort for the two LLM calls |
| `DEMO_ACCESS_CODE` | If set, uploads and re-analysis ask for this code |
| `SEED_ON_START` | Load `data/` and `seed/` on first start |
| `MAX_FILES`, `MAX_FILE_MB` | Upload limits |

`data/` is the challenge dataset exactly as provided. To use another one, replace `data/` (same layout), delete `storage/` and run `app.cli run --all`. Nothing in the code is specific to these 10 cases. A `fly.toml` is included; the live demo runs on fly.io.

## Limitations and next steps

- The rules are the simplified ones from the exercise, with no time limits, thresholds or exclusions.
- Confidence is a transparent heuristic, not a calibrated probability. Overrides are stored next to the AI's answers, so the next step is to measure where analysts disagree, by reason code, and tune from that.
- One assessment call per case is fine at this size. Much larger evidence packs would need a retrieval step first.
- Image highlights depend on OCR finding the line; when it can't, the highlight is placed approximately and the quote says so.
- SQLite on one volume is fine for a demo. Production would need Postgres, object storage, authentication and per-analyst audit trails.
- Next features: pre-filling a new case from its documents, and an insights page (override rate by reason code, time per case).
