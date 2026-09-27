"""Pydantic schemas: the case input format (matches cases.json) and the LLM output contracts."""

from typing import Literal, Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------- case input


class Money(BaseModel):
    value: float
    currency: str


class Transaction(BaseModel):
    transaction_id: str
    merchant_name: str
    merchant_mcc: Optional[str] = None
    transaction_date: str
    amount: Money
    card_bin_country: Optional[str] = None
    avs_result: Optional[str] = None
    cvv_result: Optional[str] = None
    three_ds_status: Optional[str] = None
    ip_address: Optional[str] = None
    device_fingerprint: Optional[str] = None
    billing_address_postcode: Optional[str] = None
    shipping_address_postcode: Optional[str] = None


class CaseIn(BaseModel):
    case_id: str
    scheme: Literal["visa", "mastercard"]
    reason_code: str
    reason_code_label: Optional[str] = None
    chargeback_date: str
    chargeback_amount: Money
    transaction: Transaction
    issuer_narrative: str
    merchant_evidence_documents: list[str] = Field(default_factory=list)


# ------------------------------------------------------ vision agent output


class VisionReading(BaseModel):
    transcription: str = Field(description="Every piece of visible text, line by line, in reading order, verbatim.")
    description: str = Field(description="One or two sentences on what the image shows and any visual limits (e.g. 'front view only').")
    legibility: Literal["clear", "partial", "poor"] = Field(
        description="clear: all text can be read; partial: some cannot; poor: most cannot.")


# -------------------------------------------------- assessment agent output

Verdict = Literal["satisfied", "partial", "missing", "not_applicable"]
Action = Literal["represent", "accept_liability", "request_more_evidence"]


class Citation(BaseModel):
    page_id: str = Field(description="Page identifier exactly as given, e.g. 'D1-p8', or 'TXN' for transaction data.")
    quote: str = Field(description="Verbatim excerpt copied from that page, at most ~30 words.")


class RequirementAssessment(BaseModel):
    requirement_id: str
    verdict: Verdict
    finding: str = Field(description="One or two sentences: what the evidence shows for this requirement. "
                         "For not_applicable, why it cannot apply to this transaction.")
    citations: list[Citation]
    gap: str = Field(description="What is missing or weak. Empty string when satisfied or not applicable.")
    fixable: bool = Field(description="True if the merchant could plausibly close the gap with more evidence. "
                          "False when satisfied or not applicable.")


class DocumentAssessment(BaseModel):
    document_id: str
    content_label: str = Field(description="Short label describing what the document actually is, based on its content.")
    relevance: Literal["used", "not_relevant", "unreadable"]
    reason: str = Field(description="Why it is not relevant or unreadable. Empty string when used.")


class Flag(BaseModel):
    kind: Literal["conflict", "inconsistency"]
    text: str = Field(description="One or two sentences naming the documents or fields involved and what the analyst "
                                  "should check.")


class KeyDate(BaseModel):
    label: Literal["delivery", "service", "other"]
    date: str = Field(description="ISO date YYYY-MM-DD.")
    page_id: str
    quote: str = Field(description="Verbatim text from that page that states the date.")


class Assessment(BaseModel):
    allegation: str = Field(description="Plain-English restatement of what the issuer alleges (1-2 sentences).")
    to_defend: str = Field(description="Plain-English summary of what the scheme requires to defend it (1 sentence).")
    requirements: list[RequirementAssessment]
    documents: list[DocumentAssessment]
    flags: list[Flag]
    key_dates: list[KeyDate]
    recommended_action: Action
    justification: str = Field(description="One line naming the requirement that decides the action.")
    rationale: str = Field(description="3 to 5 short points, one sentence each, one per line, ready to file.")
    merchant_requests: list[str] = Field(description="Two to five specific asks when recommended_action is "
                                               "request_more_evidence, otherwise empty.")


class RationaleRewrite(BaseModel):
    rationale: str = Field(description="3 to 5 short points, one sentence each, one per line, ready to file.")
    justification: str = Field(description="One line naming the requirement that decides the action.")
