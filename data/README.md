# Provided Materials: Schema Details

> **Note:** The original `README.md` from the challenge zip was not available. This file was reconstructed from the actual contents of `cases.json` and `documents/`. The field names and value sets below are taken directly from the data.

## Contents

| Path | What it is |
|---|---|
| `cases.json` | 10 synthetic chargeback cases (a JSON array) |
| `documents/` | 19 merchant evidence files referenced by the cases (17 PDFs, 2 PNGs) |
| `reason_codes.md` | Simplified compelling-evidence requirements per reason code and scheme |
| `reason_codes_original.pdf` | The original reason-codes document that `reason_codes.md` was transcribed from |

## `cases.json` schema

Each element of the top-level array is one case:

```jsonc
{
  "case_id": "CB-2025-0001",                 // string, unique
  "scheme": "visa",                          // "visa" | "mastercard"
  "reason_code": "13.1",                     // string, joins to reason_codes.md
  "reason_code_label": "Merchandise / Services Not Received",
  "chargeback_date": "2025-04-18",           // ISO date the issuer raised the chargeback
  "chargeback_amount": { "value": 189.99, "currency": "GBP" },

  "transaction": {
    "transaction_id": "txn_8821AB",
    "merchant_name": "NorthernThread Apparel",
    "merchant_mcc": "5651",                  // Merchant Category Code (string)
    "transaction_date": "2025-03-22T14:31:08Z", // ISO 8601 UTC
    "amount": { "value": 189.99, "currency": "GBP" },
    "card_bin_country": "GB",                // ISO-3166 alpha-2 of the issuing bank
    "avs_result": "Y",                       // "Y" = address match, "N" = no match
    "cvv_result": "M",                       // "M" = match, "N" = no match
    "three_ds_status": "authenticated",      // see values below
    "ip_address": "82.39.114.22",
    "device_fingerprint": "fp_b7d2e9c4a1",
    "billing_address_postcode": "SW4 7QR",
    "shipping_address_postcode": "SW4 7QR"
  },

  "issuer_narrative": "Free text submitted by the issuing bank on behalf of the cardholder.",
  "merchant_evidence_documents": [           // 0–4 filenames, resolved relative to documents/
    "CB-2025-0001_delivery_confirmation.pdf",
    "CB-2025-0001_carrier_tracking.pdf"
  ]
}
```

### Enumerated values seen in the dataset

| Field | Values |
|---|---|
| `scheme` | `visa`, `mastercard` |
| `avs_result` | `Y` (match), `N` (no match) |
| `cvv_result` | `M` (match), `N` (no match) |
| `three_ds_status` | `authenticated` (full challenge passed), `frictionless` (authenticated without challenge), `attempted` (merchant tried, issuer didn't complete), `not_attempted` |
| `card_bin_country` | `GB`, `DE`, `FR` |
| `currency` | `GBP`, `EUR` |

## Cases at a glance

| Case | Scheme | Code | Label | Amount | 3DS | Docs |
|---|---|---|---|---|---|---|
| CB-2025-0001 | Visa | 13.1 | Merchandise / Services Not Received | 189.99 GBP | authenticated | 2 |
| CB-2025-0002 | Visa | 13.1 | Merchandise / Services Not Received | 642.00 GBP | attempted | 2 (incl. 1 PNG) |
| CB-2025-0003 | Mastercard | 4837 | No Cardholder Authorisation | 1240.50 EUR | authenticated | 2 |
| CB-2025-0004 | Mastercard | 4837 | No Cardholder Authorisation | 87.40 GBP | not_attempted | 1 |
| CB-2025-0005 | Visa | 12.6.1 | Duplicate Processing | 54.00 GBP | frictionless | 2 |
| CB-2025-0006 | Visa | 13.3 | Not as Described or Defective | 329.00 GBP | authenticated | 3 (incl. 1 PNG) |
| CB-2025-0007 | Mastercard | 4855 | Goods / Services Not Provided | 412.75 GBP | authenticated | 1 (**10-page PDF**) |
| CB-2025-0008 | Visa | 13.2 | Cancelled Recurring Transaction | 29.99 GBP | frictionless | 1 |
| CB-2025-0009 | Mastercard | 4859 | No-Show / Addendum | 215.00 EUR | authenticated | 3 |
| CB-2025-0010 | Visa | 10.5 | Visa Fraud Monitoring Program | 78.50 GBP | authenticated | 2 |

## `documents/` naming

Files are named `<case_id>_<description>.<ext>`, e.g. `CB-2025-0007_consolidated_manifest.pdf`. All PDFs have a text layer and can be text-extracted. The two PNGs (`CB-2025-0002_tracking_screenshot.png`, `CB-2025-0006_delivery_photo.png`) need OCR or a vision model.
