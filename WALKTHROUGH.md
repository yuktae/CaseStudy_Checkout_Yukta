# Exhibit walkthrough

A tour of an analyst's session: triage, open a case, check the evidence, override, file, then bring in a new case. Screenshots are from the production Docker build with the 10 provided cases.

---

## 1. Triage the queue

![Dashboard](docs/screenshots/01-dashboard.png)

- **New case** sits on top: drop evidence files or a case JSON on it, or click to open the form.
- **Cases** below, sorted **Easiest first** by default: high-confidence cases come first so they can be cleared quickly, and the ambiguous ones are left for when the analyst has attention to spare.
- Each card answers the triage questions at a glance: who, how much, which rule, what the tool recommends, how sure it is, and what needs attention. Flag icons carry tooltips: conflict, read from an image, evidence deep in a long document, linked cases.
- Tabs follow the case lifecycle (**To review → In review → Awaiting merchant → Completed**). Filters cover scheme, category, recommendation, confidence and flags. Everything is kept in the URL, so coming back from a case restores the same view.

![List view](docs/screenshots/03-list-view.png)

The list view shows the same information densely, for scanning 80 cases a day.

---

## 2. Open a case: the rule, the evidence, the gap

![Evidence on page 8 of 10](docs/screenshots/04-case-deep-page.png)

Case **CB-2025-0007** is the "buried evidence" trap. The merchant uploaded a 10-page manifest: pages 1–7 repeat the same filler table, pages 9–10 are empty, and the proof is one line on **page 8**.

- The header gives the verdict (Represent, High confidence) and the transaction signals (AVS, CVV, 3DS, address, BIN, device, IP) without opening anything.
- The **evidence assessment** has one card per scheme requirement. Each card shows the verdict, the finding, and the exact quotes that support it.
- **Clicking a quote** opens the document, scrolls to page 8 and pulses the highlight on the exact line. The quote was matched on the transaction reference `txn_7745MN`, not on the route, because two other rows on the same page share the same postcodes.
- An alert above the workup says it plainly: *"Evidence for R1, R2, R3 is on page 8 of 10."*

---

## 3. Evidence inside images

![Image evidence](docs/screenshots/05-case-image-evidence.png)

Case **CB-2025-0002**: the only proof of delivery is a screenshot.

- Claude's vision model reads the screenshot; OCR finds each line so it can be highlighted. The chip's eye icon shows the evidence came from an image.
- The verdict is **Partial**: the parcel was "left in safe place: front porch", with no signature, at an address the cardholder says is not theirs. The gap is marked **Fixable**, and the recommendation is to request more evidence with a specific list (prior orders to that address, login and IP records, carrier photo or GPS).
- Confidence is **Low**, with its reasons stated: key evidence from an image, and evidence that conflicts with the claim.

---

## 4. The full workup, in the brief's order

![Full workup](docs/screenshots/06-case-full-workup.png)

Case **CB-2025-0006** (armchair "not as described"):

1. **Reason code**: the allegation and what is needed to defend it, in plain English.
2. **Evidence assessment**: R1 satisfied (the listing); R2 partial (a front-view photo cannot show a wobbling frame); R3 missing (the returns policy describes a route, but nothing shows what happened to the cardholder's request, so the policy is marked not relevant as evidence).
3. **Representment rationale**: drafted and editable, with a sentence counter.
4. **Recommended action**: Request more evidence, with the justification and the confidence reasons.
5. **Merchant requests**: specific asks, with *Copy as email*.

---

## 5. Rules the code enforces

![Auto-accept rule](docs/screenshots/07-case-auto-rule.png)

Case **CB-2025-0010** is Visa **10.5** (fraud monitoring). The merchant uploaded strong-looking evidence: 3DS authentication and a signed delivery. Under the rules this code cannot be represented unless the issuer miscoded it.

On this run the model was persuaded by that evidence and argued for representing. This is exactly the failure the brief's trap cases are designed to provoke. Because the rule is enforced **in code**:

- the recommendation stays **Accept liability**;
- the case is flagged **Needs judgement**, with the rule check and the AI's view side by side, and confidence drops to Low;
- the drafted rationale is labelled as arguing for the other action, so it is not filed by mistake.

---

## 6. Override anything

![Verdict override](docs/screenshots/08-verdict-override.png)

- Every verdict can be changed, with an optional note. The card then shows **Edited**, and the AI's original verdict stays visible.
- The analyst can also mark a document relevant or not relevant, change the action (a reason is required), and edit the justification, rationale and merchant requests.
- **Save** keeps the review. **Complete** shows a summary of what will be filed (including how many overrides were made), sets the status (*Completed*, or *Awaiting merchant* for evidence requests) and opens the next open case.

---

## 7. New cases and new evidence

![New case](docs/screenshots/02-new-case.png)

- **New case** opens a three-step form: *Case → Transaction → Evidence*. Dropping a JSON in the `cases.json` format fills every field, and dropped PDFs or images are attached on step 3. Fields are validated as the analyst goes, for example "must be before the chargeback date".
- **Analyse case** starts a background job. The **processing panel** (bottom right) shows each stage (extracting text, reading images, checking rules, assessing evidence, locating highlights) and turns into an **Open** button when the case is ready. The card in the grid fills in at the same moment.
- On any case, **Add evidence** brings up a **Re-analyse case** banner. The re-analysis creates a new version: in testing, adding an account log to CB-2025-0008 moved it from *Request more evidence* to *Represent*. The three requirements it changed were tagged **Updated**, and Claude flagged that the added log was marked as a test document and should be checked for authenticity.

---

## Keyboard

| Key | Action |
|---|---|
| `]` / `[` | Next / previous piece of evidence |
| `Esc` | Clear the evidence focus |

Deep links: `/cases/CB-2025-0007?evidence=R1-0` opens a case focused on one piece of evidence.
